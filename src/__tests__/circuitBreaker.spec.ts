import { TServiceCall, IMethodDefinition, ICircuitBreakerOptions, IInterceptingCallOptions } from "../defs";
import { CircuitBreaker } from "../index";
import { mock, mockClear, mockDeep, MockProxy, mockReset } from "jest-mock-extended";
import { defaultContext as defaultContextUntyped } from "processing-context";
import { InterceptingCall, Listener, Metadata } from "grpc";
import camelCase from "camelcase";

jest.mock("processing-context");
const defaultContext = mock(defaultContextUntyped);

const wait = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) });

const now = 1611831824947;
const testMethodRawProtoName = "some.test_method:name";
const testMethodPath = `some.test_path.to-proto/${testMethodRawProtoName}`;
const testMethodName = camelCase(testMethodRawProtoName);
const testMethodTimeout = 200;
const testMethodDeadline = now + testMethodTimeout;
const defaultTimeout = 500;

const alwaysExceededConfig: ICircuitBreakerOptions = {
  timeouts: { default: 0 },
  minResponseTimeouts: { default: 100 }
};

describe("#CircuitBreaker", () => {
  const dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);

  afterEach(() => {
    dateNowSpy.mockReset();
    dateNowSpy.mockImplementation(() => now);
  });

  describe(".serverInterceptor", () => {
    const call = mockDeep<TServiceCall>();
    const methodDefinition = mock<IMethodDefinition>({ originalName: testMethodName });
    const next = jest.fn();

    beforeEach(() => {
      call.metadata.getMap.mockImplementation(() => ({}));
    });

    afterEach(() => {
      mockReset(call);
      mockClear(methodDefinition);
      next.mockClear();
    });

    it("correctly defines method name", async () => {
      const { serverInterceptor } = new CircuitBreaker(alwaysExceededConfig);

      await serverInterceptor(call, methodDefinition, next);

      expect(call.call.cancelWithStatus.mock.calls[0][1]).toMatch(testMethodName);
    });

    it("correctly defines method name if grpc-host-builder is not used", async () => {
      const { serverInterceptor } = new CircuitBreaker(alwaysExceededConfig);
      const methodDefinitionWithPath = mock<IMethodDefinition>({ path: testMethodPath, originalName: undefined });

      await serverInterceptor(call, methodDefinitionWithPath, next);

      expect(call.call.cancelWithStatus.mock.calls[0][1]).toMatch(testMethodName);
    });

    it("uses timeout for method, if it's defined in config", async () => {
      const timeoutsConfig = {
        timeouts: {
          [testMethodName]: testMethodTimeout,
          default: defaultTimeout
        }
      };
      const { serverInterceptor } = new CircuitBreaker(timeoutsConfig);

      await serverInterceptor(call, methodDefinition, next);

      expect(defaultContext.set).toHaveBeenCalledWith("deadline", testMethodDeadline);
    });

    it("uses default timeout for method, if it's not defined in config", async () => {
      const timeoutsConfig = {
        timeouts: { default: defaultTimeout }
      };
      const { serverInterceptor } = new CircuitBreaker(timeoutsConfig);

      await serverInterceptor(call, methodDefinition, next);

      expect(defaultContext.set).toHaveBeenCalledWith("deadline", now + defaultTimeout);
    });

    it("uses min response timeout for method, if it's defined in config", async () => {
      const timeoutsConfig = {
        timeouts: { default: defaultTimeout },
        minResponseTimeouts: { [testMethodName]: testMethodTimeout }
      };
      const { serverInterceptor } = new CircuitBreaker(timeoutsConfig);

      await serverInterceptor(call, methodDefinition, next);

      expect(next).toBeCalledTimes(1);
    });

    it("uses default min response timeout for method, if it's not defined in config", async () => {
      const timeoutsConfig = {
        timeouts: { default: defaultTimeout },
        minResponseTimeouts: { default: testMethodTimeout }
      };
      const { serverInterceptor } = new CircuitBreaker(timeoutsConfig);

      await serverInterceptor(call, methodDefinition, next);

      expect(next).toBeCalledTimes(1);
    });

    it("uses own deadline if there is no total deadline in metadata", async () => {
      const timeoutsConfig = {
        timeouts: { [testMethodName]: testMethodTimeout }
      };
      const { serverInterceptor } = new CircuitBreaker(timeoutsConfig);

      await serverInterceptor(call, methodDefinition, next);

      expect(defaultContext.set).toHaveBeenCalledWith("deadline", testMethodDeadline);
    });

    it("uses total deadline if there is one in metadata", async () => {
      const timeoutsConfig = {
        timeouts: { [testMethodName]: testMethodTimeout }
      };
      const { serverInterceptor } = new CircuitBreaker(timeoutsConfig);
      call.metadata.getMap.mockImplementationOnce(() => ({ "grpc-total-deadline": String(now) }));

      await serverInterceptor(call, methodDefinition, next);

      expect(defaultContext.set).toHaveBeenCalledWith("deadline", now);
    });

    it("uses shortest possible deadline", async () => {
      const timeoutsConfig = {
        timeouts: { [testMethodName]: testMethodTimeout }
      };
      const { serverInterceptor } = new CircuitBreaker(timeoutsConfig);
      call.metadata.getMap.mockImplementation(() => ({ "grpc-total-deadline": String(testMethodDeadline + 1) }));

      await serverInterceptor(call, methodDefinition, next);

      expect(defaultContext.set).toHaveBeenCalledWith("deadline", testMethodDeadline);
    });

    it("cancels request if fastest possible response will exceed deadline", async () => {
      const timeoutsConfig = {
        timeouts: { default: testMethodTimeout },
        minResponseTimeouts: { default: defaultTimeout }
      };
      const { serverInterceptor } = new CircuitBreaker(timeoutsConfig);

      await serverInterceptor(call, methodDefinition, next);

      expect(call.call.cancelWithStatus).toBeCalledTimes(1);
    });

    it("cancels request if deadline was already exceeded", async () => {
      const timeoutsConfig = {
        timeouts: { [testMethodName]: testMethodTimeout }
      };
      const { serverInterceptor } = new CircuitBreaker(timeoutsConfig);
      call.metadata.getMap.mockImplementationOnce(() => ({ "grpc-total-deadline": String(now - 1) }));

      await serverInterceptor(call, methodDefinition, next);

      expect(call.call.cancelWithStatus).toBeCalledTimes(1);
    });

    it("cancels long request when it exceeds deadline", async () => {
      const timeoutsConfig = {
        timeouts: { [testMethodName]: testMethodTimeout }
      };
      const { serverInterceptor } = new CircuitBreaker(timeoutsConfig);
      next.mockImplementationOnce(() => wait(testMethodTimeout * 2))

      await serverInterceptor(call, methodDefinition, next);

      expect(call.call.cancelWithStatus).toBeCalledTimes(1);
    });
  });

  describe(".clientInterceptor", () => {
    const methodDefinition = mock<IMethodDefinition>({ path: testMethodPath, originalName: undefined })
    const options = mockDeep<IInterceptingCallOptions>({ method_definition: methodDefinition });
    const metadata = mock<Metadata>();
    const listner = mock<Listener>();
    const next_call = mock<InterceptingCall>();
    const next = (): InterceptingCall => next_call;

    const getCallMock = (call: InterceptingCall): MockProxy<InterceptingCall> & InterceptingCall => {
      call.cancelWithStatus = jest.fn();
      const callMock = mockDeep<InterceptingCall>(call);
      return callMock;
    }

    beforeEach(() => {
      defaultContext.get.mockImplementation();
    });

    afterEach(() => {
      mockReset(defaultContext);

      mockClear(metadata);
      mockClear(listner);
      mockClear(next_call);
    });

    it("correctly defines method name", () => {
      const { clientInterceptor } = new CircuitBreaker(alwaysExceededConfig);

      const call = getCallMock(clientInterceptor(options, next));
      call.start(metadata, listner);

      expect(call.cancelWithStatus.mock.calls[0][1]).toMatch(testMethodName);
    });

    it("uses own deadline if there is no total deadline in default context", () => {
      const timeoutsConfig = {
        timeouts: { [testMethodName]: testMethodTimeout }
      };
      const { clientInterceptor } = new CircuitBreaker(timeoutsConfig);

      const call = getCallMock(clientInterceptor(options, next));
      call.start(metadata, listner);

      expect(metadata.set).toHaveBeenCalledWith("grpc-total-deadline", String(testMethodDeadline));
    });

    it("uses total deadline if there is one in metadata", () => {
      const timeoutsConfig = {
        timeouts: { [testMethodName]: testMethodTimeout }
      };
      const { clientInterceptor } = new CircuitBreaker(timeoutsConfig);
      defaultContext.get.mockImplementationOnce(() => now);

      const call = getCallMock(clientInterceptor(options, next));
      call.start(metadata, listner);

      expect(metadata.set).toHaveBeenCalledWith("grpc-total-deadline", String(now));
    });

    it("uses shortest possible deadline", () => {
      const timeoutsConfig = {
        timeouts: { [testMethodName]: testMethodTimeout }
      };
      const { clientInterceptor } = new CircuitBreaker(timeoutsConfig);
      defaultContext.get.mockImplementationOnce(() => testMethodDeadline + 1);

      const call = getCallMock(clientInterceptor(options, next));
      call.start(metadata, listner);

      expect(metadata.set).toHaveBeenCalledWith("grpc-total-deadline", String(testMethodDeadline));
    });

    it("cancel request without any further processing if deadline was already exceed", () => {
      const timeoutsConfig = {
        timeouts: { [testMethodName]: testMethodTimeout }
      };
      const { clientInterceptor } = new CircuitBreaker(timeoutsConfig);
      defaultContext.get.mockImplementationOnce(() => now - 1);

      const call = getCallMock(clientInterceptor(options, next));
      call.start(metadata, listner);

      expect(call.cancelWithStatus).toBeCalledTimes(1);
      expect(next_call.start).not.toHaveBeenCalled();
    });
  });
});
