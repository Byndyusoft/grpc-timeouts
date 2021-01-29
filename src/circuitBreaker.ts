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
  IMetaDataMap,
  IDeadlineInfo
} from "./defs"

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MINIMAL_RESPONSE_TIME = 0;

export interface ICircuitBreaker {
  serverInterceptor: IServerInterceptor;
  clientInterceptor: IClientInterceptor;
}

export class CircuitBreaker implements ICircuitBreaker {
  private readonly timeouts: ITimeouts;
  private readonly minResponseTimeouts: ITimeouts;

  public constructor(options?: ICircuitBreakerOptions) {
    this.timeouts = parseTimeouts(options?.timeouts, DEFAULT_TIMEOUT);
    this.minResponseTimeouts = parseTimeouts(options?.minResponseTimeouts, DEFAULT_MINIMAL_RESPONSE_TIME);
  }

  public get serverInterceptor(): IServerInterceptor {
    return async (call: TServiceCall, methodDefinition: IMethodDefinition, next: IServiceCallHandler) => {
      const callMetadata = call.metadata.getMap() as IMetaDataMap;
      const now = Date.now();
      const deadlineInfo = this.getDeadlineForMethod(methodDefinition, callMetadata["grpc-total-deadline"], now);
      const { deadline, fastestPossibleResponse, method } = deadlineInfo;

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
      const call = new InterceptingCall(next(options), {
        start: (metadata, listener, next_start) => {
          const deadlineInfo = this.getDeadlineForMethod(options.method_definition, defaultContext.get("deadline"));
          const { deadline, fastestPossibleResponse, method } = deadlineInfo;

          metadata.set("grpc-total-deadline", String(deadline));

          if (fastestPossibleResponse > deadline) cancelRequest(call, method, false);
          else next_start(metadata, listener);
        }
      });

      return call;
    }
  }

  private getDeadlineForMethod(methodDefinition: IMethodDefinition, maybeTotalDeadline: unknown, now = Date.now()): IDeadlineInfo {
    const method = methodDefinition.originalName ?? getMethodName(methodDefinition.path);
    const timeout = this.timeouts[method] ?? this.timeouts.default;
    const minResponseTimeout = this.minResponseTimeouts[method] ?? this.minResponseTimeouts.default;
    const fastestPossibleResponse = now + minResponseTimeout;

    const ownDeadline = now + timeout;
    const totalDeadline = Number(maybeTotalDeadline ?? ownDeadline);
    const deadline = Math.min(totalDeadline, ownDeadline);

    return { deadline, fastestPossibleResponse, method };
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

function parseTimeouts(maybeTimeouts: unknown, defaultTimeout: number): ITimeouts {
  if (!(maybeTimeouts instanceof Object)) return { default: defaultTimeout };

  const timeouts = maybeTimeouts as Record<string, unknown>;
  for (const key of Object.keys(timeouts)) {
    const value = Number(timeouts[key]);
    if (Number.isNaN(value)) throw new Error(`Timeout for method ${key} has type ${typeof timeouts[key]} but number expected`);
    timeouts[key] = value;
  }

  return Object.assign({ default: defaultTimeout }, timeouts as ITimeouts);
}
