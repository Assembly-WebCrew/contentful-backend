'use strict';

const cfGraphql = require('cf-graphql');
const express = require('express');
const graphqlHTTP = require('express-graphql');
const {getLogger, getConfig} = require('./utils');

const logger = getLogger('server');

try {
    const config = getConfig();

    initializeContentful(config)
        .catch(err => {
            logger.fatal(err.message);
            process.exit(1);
        });
} catch (err) {
    logger.fatal(err.message);
    process.exit(1);
}

async function initializeContentful({spaceId, cdaToken, cmaToken, hostname, port}) {
    try {
        logger.info(`Fetching content types for space (${spaceId}) to create a space graph`);
        logger.trace(`Configuration: ${JSON.stringify({spaceId, cdaToken, cmaToken, hostname, port})}`);
        logger.debug(`Initializing contentful client for space ${spaceId}`);
        const client = cfGraphql.createClient({spaceId, cdaToken, cmaToken});

        logger.debug('Fetching content types');
        const contentTypes = await client.getContentTypes();
        logger.debug('Creating space graph');
        const spaceGraph = await cfGraphql.prepareSpaceGraph(contentTypes);

        const names = spaceGraph.map(ct => ct.names.type).join(', ');
        logger.debug(`Contentful content types prepared: ${names}`);

        logger.info('Creating GraphQL schema');
        const schema = await cfGraphql.createSchema(spaceGraph);

        startServer({hostname, port}, client, schema);
    } catch (err) {
        logger.fatal(err.message);
        process.exit(1);
    }
}

function startServer({hostname, port}, client, schema) {
    logger.info(`Starting server at ${hostname}:${port}`);
    const app = express();

    const ui = cfGraphql.helpers.graphiql({title: 'cf-graphql demo'});
    app.get('/graphiql', (_, res) => res.set(ui.headers).status(ui.statusCode).end(ui.body));

    // TODO: Universal rendering

    const opts = {version: true, timeline: true, detailedErrors: false};
    const ext = cfGraphql.helpers.expressGraphqlExtension(client, schema, opts);
    app.use('/graphql', graphqlHTTP(ext));

    app.listen(port, hostname);
    console.log('Running a GraphQL server!');
    console.log(`You can access GraphiQL at http://${hostname}:${port}/graphiql/`);
    console.log(`You can use the GraphQL endpoint at http://${hostname}:${port}/graphql/`);
}