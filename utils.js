const getEnvValue = (key, defaultValue) => process.env[key] || defaultValue;

module.exports = {
    getConfig: () => ({
        hostname: getEnvValue('CONTENTFUL_HOSTNAME', 'localhost'),
        port: getEnvValue('CONTENTFUL_PORT', 4000),
        basePath: getEnvValue('CONTENTFUL_BASE_PATH', '/'),
        space: getEnvValue('CONTENTFUL_SPACE_ID', undefined),
        accessToken: getEnvValue('CONTENTFUL_CONTENT_TOKEN', undefined),
        managementToken: getEnvValue('CONTENTFUL_MANAGEMENT_TOKEN', undefined)
    }),
    getLogger: name => ({
        trace: message => {},
        verbose: message => {},
        debug: message => console.log(message),
        info: message => console.log(message),
        warn: message => console.warn(message),
        error: message => console.error(message),
        fatal: message => console.error(message)
    })
};
