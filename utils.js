function getEnvValue(key, defaultValue, required) {
    const value = process.env[key];
    if (!value && required) {
        throw new Error(`Missing required configuration value: "${key}"`);
    }

    return value || defaultValue;
}

module.exports = {
    getConfig: () => ({
        hostname: getEnvValue('CONTENTFUL_HOSTNAME', 'localhost'),
        port: getEnvValue('CONTENTFUL_PORT', 4000),
        spaceId: getEnvValue('CONTENTFUL_SPACE_ID', undefined, true),
        cdaToken: getEnvValue('CONTENTFUL_CONTENT_TOKEN', undefined, true),
        cmaToken: getEnvValue('CONTENTFUL_MANAGEMENT_TOKEN', undefined, true)
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