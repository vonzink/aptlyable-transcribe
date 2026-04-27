import type { APIGatewayProxyResultV2, APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { log } from '@aptlyable/shared';
import { config } from './config';

/**
 * Pick the right CORS origin to echo back: only echo origins on our
 * allow-list. Falls back to the first allowed origin if the request
 * Origin header is absent or unrecognized.
 */
function pickAllowOrigin(event?: APIGatewayProxyEventV2): string {
  const requestOrigin = event?.headers?.origin ?? event?.headers?.Origin;
  if (requestOrigin && config.allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  return config.allowedOrigins[0] ?? '*';
}

function corsHeaders(event?: APIGatewayProxyEventV2): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': pickAllowOrigin(event),
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  };
}

export function ok<T>(body: T, event?: APIGatewayProxyEventV2): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(event) },
    body: JSON.stringify(body),
  };
}

export function created<T>(body: T, event?: APIGatewayProxyEventV2): APIGatewayProxyResultV2 {
  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(event) },
    body: JSON.stringify(body),
  };
}

export function badRequest(
  message: string,
  details?: unknown,
  event?: APIGatewayProxyEventV2,
): APIGatewayProxyResultV2 {
  return {
    statusCode: 400,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(event) },
    body: JSON.stringify({ error: message, details }),
  };
}

export function notFound(message: string, event?: APIGatewayProxyEventV2): APIGatewayProxyResultV2 {
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(event) },
    body: JSON.stringify({ error: message }),
  };
}

export function conflict(message: string, event?: APIGatewayProxyEventV2): APIGatewayProxyResultV2 {
  return {
    statusCode: 409,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(event) },
    body: JSON.stringify({ error: message }),
  };
}

export function serverError(
  message: string,
  details?: unknown,
  event?: APIGatewayProxyEventV2,
): APIGatewayProxyResultV2 {
  return {
    statusCode: 500,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(event) },
    body: JSON.stringify({ error: message, details }),
  };
}

/** Parse JSON body, returning undefined if empty/invalid. */
export function parseJsonBody<T = unknown>(event: APIGatewayProxyEventV2): T | undefined {
  if (!event.body) return undefined;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * Wraps a handler with structured error logging + uniform error shape.
 * Keeps individual handlers focused on the happy path.
 *
 * The wrapped function receives a `requestLog` argument bound with the
 * Lambda's `awsRequestId` plus HTTP path/method, so every line emitted
 * during a single invocation is correlatable.
 */
import type { Logger } from '@aptlyable/shared';
export type WrappedHandler = (
  event: APIGatewayProxyEventV2,
  requestLog: Logger,
) => Promise<APIGatewayProxyResultV2>;

export function wrap(
  fn: WrappedHandler,
): (event: APIGatewayProxyEventV2, context?: Context) => Promise<APIGatewayProxyResultV2> {
  return async (event, context) => {
    const requestLog = log.withFields({
      requestId: context?.awsRequestId,
      path: event.requestContext?.http?.path,
      method: event.requestContext?.http?.method,
    });
    try {
      return await fn(event, requestLog);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      requestLog.error('unhandled handler error', {
        error: message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      return serverError('Internal server error', undefined, event);
    }
  };
}
