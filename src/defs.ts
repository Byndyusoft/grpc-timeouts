import {
  MethodDefinition as GRPCMethodDefinition,
  ServerUnaryCall,
  ServerReadableStream,
  ServerWriteableStream,
  ServerDuplexStream,
  InterceptingCall,
  MetadataValue
} from "grpc";

export interface ITimeouts {
  [key: string]: number | undefined;
  default: number;
}

export interface ICircuitBreakerOptions {
  timeouts?: Partial<ITimeouts>;
  minResponseTimeouts?: Partial<ITimeouts>;
}

export interface IServerInterceptor<RequestType = unknown, ResponseType = unknown> {
  (call: TServiceCall<RequestType, ResponseType>, methodDefinition: IMethodDefinition, next: IServiceCallHandler): Promise<ResponseType>;
}

export interface IClientInterceptor {
  (options: IInterceptingCallOptions, next: INextCall): InterceptingCall;
}


export interface IDeadlineInfo {
  deadline: number,
  fastestPossibleResponse: number,
  method: string
}

export type TServiceCall<RequestType = unknown, ResponseType = unknown> =
  (
  | ServerUnaryCall<RequestType>
  | ServerReadableStream<RequestType>
  | ServerWriteableStream<RequestType, ResponseType>
  | ServerDuplexStream<RequestType, ResponseType>
  )
  & ({ call: InterceptingCall });

export interface IMethodDefinition<RequestType = unknown, ResponseType = unknown> extends GRPCMethodDefinition<RequestType, ResponseType> {
  originalName?: string,
  domain?: unknown
}

export interface IServiceCallHandler<RequestType = unknown, ResponseType = unknown> {
  (call: TServiceCall<RequestType, ResponseType>): Promise<ResponseType>
}

export interface INextCall {
  (options: IInterceptingCallOptions): InterceptingCall | null
}

export interface IInterceptingCallOptions<RequestType = unknown, ResponseType = unknown> {
  method_definition: GRPCMethodDefinition<RequestType, ResponseType>
}

export interface IMetaDataMap {
  [key: string]: MetadataValue | undefined
}
