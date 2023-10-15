// eslint-disable-next-line @typescript-eslint/no-var-requires
const { promises: fs } = require("fs");

module.exports = async ({ resolveVariable }) => {
  const stage = await resolveVariable("sls:stage");
  const fileData = await fs.readFile("./redirects.js", { encoding: "utf-8" });
  return `var STAGE=${JSON.stringify(stage)};\n\n${fileData}`;
};
