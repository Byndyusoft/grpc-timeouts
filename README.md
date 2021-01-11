# grpc-timeouts

[![npm version](https://img.shields.io/npm/v/@byndyusoft/grpc-timeouts)](https://www.npmjs.com/package/@byndyusoft/grpc-timeouts)
[![npm downloads](https://img.shields.io/npm/dt/@byndyusoft/grpc-timeouts)](https://www.npmjs.com/package/@byndyusoft/grpc-timeouts)
[![dependencies](https://img.shields.io/david/Byndyusoft/grpc-timeouts)](https://www.npmjs.com/package/@byndyusoft/grpc-timeouts)
[![dev dependencies](https://img.shields.io/david/dev/Byndyusoft/grpc-timeouts)](https://www.npmjs.com/package/@byndyusoft/grpc-timeouts)
[![Build Status](https://img.shields.io/github/workflow/status/Byndyusoft/grpc-timeouts/test%20workflow/master)](https://github.com/Byndyusoft/grpc-timeouts/actions?query=workflow%3A%22test+workflow%22)

## Table of contents
- [About](#about)
- [Installation](#installation)
- [Usage](#usage)
- [API](#api)
  - [CircuitBreaker](#circuitbreaker)
    - [serverInterceptor](#serverinterceptor)
    - [clientInterceptor](#clientinterceptor)
- [Type Definitions](#typedefinitions)
  - [ICircuitBreakerOptions](#icircuitbreakeroptions)
  - [ITimeouts](#itimeouts)
  - [IServerInterceptor](#iserverinterceptor)
  - [IClientInterceptor](#iclientinterceptor)
- [Related](#related)
- [Maintainers](#maintainers)

## About
`grpc-timeouts` is a small library that makes it easy to add customizable timeouts to your services. The library implements a circuit breaker pattern, which means that if the request exceeds the deadline, no further requests will be sent. If the deadline for a received request has expired, the request will not be processed and service instantly answers with code 4 (Deadline exceeded).

## Installation

`npm i @byndyusoft/grpc-timeouts`

## Usage
**:warning: Make sure that CircuitBreaker interceptors is the last added interceptor, because it will interrupt further processing of the request!**
```js
const grpc = require("grpc")
const { CircuitBreaker } = require("@byndyusoft/grpc-timeouts");
const circuitBreaker = new CircuitBreaker();

/*...*/

// Client interceptor:
const client = new grpc.Client(address, credentials, {
  interceptors: [circuitBreaker.clientInterceptor]
});

// Server interceptor: (with grpc-host-builder)
const server = new GrpcHostBuilder()
  .addInterceptor(circuitBreaker.serverInterceptor)
  .addService(myService)
  .bind(grpcBind)
  .build()
```

## API
### CircuitBreaker
`constructor([options: ICircuitBreakerOptions])`

Options is an optional object with timeouts for methods (default timeout is 10 seconds).

#### serverInterceptor
`IServerInterceptor`

Server interceptor function.

#### clientInterceptor
`IClientInterceptor`

Client interceptor function.

## Type Definitions
### ICircuitBreakerOptions
An object with following keys:
- `[timeouts: ITimeouts]` - The longest time for the methods to respond
- `[minResponseTimeouts: ITimeouts]` - The shortest time to wait for a response from the services
```js
{
  timeouts: {
    createOrder: 3000,
    updateOrder: 500,
    deleteOrder: 500,
    getOrder: 300,
    default: 5000 //default was 10000
  },
  minResponseTimeouts: {
    createOrder: 280,
    default: 50 //default was 0
  }
}
```
### ITimeouts
An object which keys is camelCased method names and values is milliseconds. \
This object also have `default` field that can be reassigned.

### IServerInterceptor
`(call: Object, methodDefinition: Object, next: Function) => Promise<Object>` \
A function that can be used as server interceptor.

### IClientInterceptor
`(options: Object, next: Function) => grpc.InterceptingCall` \
A function that can be used as client interceptor.

## Related
[grpc-host-builder](https://www.npmjs.com/package/grpc-host-builder)

## Maintainers
@Byndyusoft/owners: https://github.com/orgs/Byndyusoft/teams/owners, github.maintain@byndyusoft.com
