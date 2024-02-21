const path = require('path');

module.exports = {
  entry: './public-src/date-fns-wrapper.mjs',
  output: {
    path: path.resolve(__dirname, './public'),
    filename: 'date-fns-3.3.1.js',
  },
  //   experiments: {
  //     outputModule: false,
  //   },
  plugins: [
    //empty pluggins array
  ],
  module: {
    // https://webpack.js.org/loaders/babel-loader/#root
    rules: [
      {
        test: /.m?js$/,
        loader: 'babel-loader',
        exclude: /node_modules/,
      },
    ],
  },
};
