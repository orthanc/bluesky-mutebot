/* eslint-disable no-undef */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { promises: fs } = require('fs');

module.exports = async () => {
  const files = await fs.readdir('./public');
  return files.find((file) => file.match(/mutebot\..+\.css$/));
};
