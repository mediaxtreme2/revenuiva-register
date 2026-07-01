const { withProjectBuildGradle } = require('expo/config-plugins');

function withSquareMaven(config) {
  return withProjectBuildGradle(config, (config) => {
    const buildGradle = config.modResults.contents;

    const squareRepo = `        maven { url "https://sdk.squareup.com/public/android/" }`;

    if (!buildGradle.includes('squareup.com')) {
      // Add Square Maven repo to allprojects.repositories
      config.modResults.contents = buildGradle.replace(
        /allprojects\s*\{[\s\S]*?repositories\s*\{/,
        (match) => `${match}\n${squareRepo}`
      );
    }

    return config;
  });
}

module.exports = withSquareMaven;
