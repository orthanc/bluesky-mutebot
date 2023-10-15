/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-undef */
const { SSMClient, GetParametersCommand } = require('@aws-sdk/client-ssm'); // CommonJS import
const ssmClient = new SSMClient({ region: 'us-west-2' });

const variables = {
  CONTENT_BUCKET: 'content-bucket',
  WEBSOCKET_DOMAIN: `/bluesky-feeds/${process.env.TARGET_STAGE}/console/ws-domain-name`,
};

const main = async () => {
  const targetStage = process.env.TARGET_STAGE;
  if (targetStage == null) {
    throw new Error(
      `Must specify environment variable TARGET_STAGE=development|production`
    );
  }
  const ssmResult = await ssmClient.send(
    new GetParametersCommand({
      Names: Object.values(variables),
    })
  );

  Object.entries(variables).forEach(([envVar, ssmName]) => {
    const value = (ssmResult.Parameters || []).find(
      (param) => param.Name === ssmName
    );
    if (value == null || value.Value == null) {
      throw new Error(`Unable to find SSM ${ssmName} for ${envVar}`);
    }
    console.log(`export ${envVar}=${JSON.stringify(value.Value)};`);
  });
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
