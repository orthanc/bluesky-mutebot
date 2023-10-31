import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import httpErrorHandler from '@middy/http-error-handler';
import httpHeaderNormalizer from '@middy/http-header-normalizer';

import { renderPage } from './pages';

export const rawHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  return renderPage(event);
};

export const handler = middy(rawHandler)
  .use(httpErrorHandler())
  .use(httpHeaderNormalizer());
