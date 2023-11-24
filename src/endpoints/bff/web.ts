import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import httpErrorHandler from '@middy/http-error-handler';
import httpHeaderNormalizer from '@middy/http-header-normalizer';
import httpUrlEncodeBodyParser from '@middy/http-urlencode-body-parser';
import { renderResponse } from './pages';

export const rawHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  return renderResponse(event);
};

export const handler = middy(rawHandler)
  .use(httpErrorHandler())
  .use(httpHeaderNormalizer())
  .use(httpUrlEncodeBodyParser());
