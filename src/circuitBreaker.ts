import { defaultContext } from "processing-context";
import { InterceptingCall, status as GRPCStatus } from "grpc";
import camelCase from "camelcase";
import {
  ITimeouts,
  ICircuitBreakerOptions,
  IServerInterceptor,
  IClientInterceptor,
  IInterceptingCallOptions,
  TServiceCall,
  IMethodDefinition,
  IServiceCallHandler,
  INextCall,
  IMetaDataMap
} from "./defs"

export interface ICircuitBreaker {
  serverInterceptor: IServerInterceptor;
  clientInterceptor: IClientInterceptor;
}

export class CircuitBreaker implements ICircuitBreaker {
  private readonly timeouts: ITimeouts;
  private readonly minResponseTimeouts: ITimeouts;

  public constructor(options?: ICircuitBreakerOptions) {
    //eslint-disable-next-line @typescript-eslint/no-magic-numbers
    this.timeouts = this.parseTimeouts(options?.timeouts, 10 * 1000);
    this.minResponseTimeouts = this.parseTimeouts(options?.minResponseTimeouts, 0);
  }

  public get serverInterceptor(): IServerInterceptor {
    return async (call: TServiceCall, methodDefinition: IMethodDefinition, next: IServiceCallHandler) => {
      const callMetadata = call.metadata.getMap() as IMetaDataMap;

      const method = methodDefinition.originalName ?? getMethodName(methodDefinition.path);
      const timeout = this.timeouts[method] ?? this.timeouts.default;
      const minResponseTimeout = this.minResponseTimeouts[method] ?? 0;
      const now = Date.now();
      const fastestPossibleResponse = now + minResponseTimeout;

      const ownDeadline = now + timeout;
      const totalDeadline = Number(callMetadata["grpc-total-deadline"] ?? ownDeadline);
      const deadline = Math.min(totalDeadline, ownDeadline);
      defaultContext.set("deadline", deadline);

      if (fastestPossibleResponse > deadline) return cancelRequest(call.call, method);
      const timer = setTimeout(() => cancelRequest(call.call, method), deadline - now);

      const result = await next(call);
      clearTimeout(timer);
      return result;
    }
  }

  public get clientInterceptor(): IClientInterceptor {
    return (options: IInterceptingCallOptions, next: INextCall) => {
      const method = getMethodName(options.method_definition.path);
      const minResponseTimeout = this.minResponseTimeouts[method] ?? 0;
      const call = new InterceptingCall(next(options), {
        start(metadata, listener, next_start) {
          const now = Date.now();
          const fastestPossibleResponse = now + minResponseTimeout;

          const deadline = Number(defaultContext.get("deadline"));
          metadata.set("grpc-total-deadline", String(deadline));

          if (fastestPossibleResponse > deadline) cancelRequest(call, method, false);
          else next_start(metadata, listener);
        }
      });
      return call;
    }
  }

  private parseTimeouts(maybeTimeouts: unknown, defaultTimeout: number): ITimeouts {
    if (!(maybeTimeouts instanceof Object)) return { default: defaultTimeout };

    const timeouts = maybeTimeouts as Record<string, unknown>;
    for (const key of Object.keys(timeouts)) {
      const value = Number(timeouts[key]);
      if (Number.isNaN(value)) throw new Error(`Timeout for method ${key} has type ${typeof timeouts[key]} but number expected`);
      timeouts[key] = value;
    }

    return Object.assign({ default: defaultTimeout }, timeouts as ITimeouts);
  }
}

function cancelRequest(call: InterceptingCall, method: string, incoming = true): Record<never, never> {
  const code = GRPCStatus.DEADLINE_EXCEEDED;
  const details = `${incoming ? "Incoming" : "Outgoing"} request to method ${method}`;
  // @ts-expect-error InterceptingCall.cancelWithStatus type declaration is incorrect. `code` should be a number, but `StatusObject` declared
  call.cancelWithStatus(code, details);
  return {};
}

function getMethodName(protoPath: string): string {
  const methodName = protoPath.split("/").pop();
  if (!methodName) return protoPath;
  return camelCase(methodName);
}
