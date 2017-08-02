'use strict';

require('dotenv-safe').load();
const contentful = require('contentful');
const cfGraphql = require('cf-graphql');
const express = require('express');
const graphqlHTTP = require('express-graphql');
const { getLogger, getConfig } = require('./utils');
const logger = getLogger('server');
const { cloneDeep } = require('lodash');
const cors = require('cors');

// Cache.
const events = new Map();
const middleware = new Map();
const defaultEvent = Symbol('default event');

class EventIndex {
  constructor({ spaceId, cdaToken }) {
    this.client = contentful.createClient({
      space: spaceId,
      accessToken: cdaToken
    });
  }

  getEventKey(name) {
    return name ? name : defaultEvent;
  }

  async getEvent(name) {
    const eventKey = this.getEventKey(name);
    const options = {
      content_type: 'event',
      limit: 1
    };

    if (name) {
      options['fields.name'] = name
    } else {
      options['fields.isDefault'] = true;
    }

    if (events.has(eventKey)) {
      const eventData = cloneDeep(events.get(eventKey));
      logger.debug(`Found event ${eventData.name}`);
      return eventData;
    } else {
      const entries = await this.client.getEntries(options);
      const eventData = entries.items[0].fields;
      events.set(eventKey, cloneDeep(eventData));
      logger.debug(`Found event ${eventData.name}`);
      return eventData;
    }
  }

  async getEventApi(name) {
    const eventKey = this.getEventKey(name);

    if (middleware.has(eventKey)) {
      return middleware.get(eventKey);
    }

    const { secrets } = await this.getEvent(name);
    const { spaceId, cdaToken, cmaToken } = secrets;

    logger.info(`Fetching content types for space (${spaceId}) to create a space graph`);
    logger.trace(`Configuration: ${JSON.stringify({ spaceId, cdaToken, cmaToken })}`);
    logger.debug(`Initializing contentful client for space ${spaceId}`);
    const client = cfGraphql.createClient({ spaceId, cdaToken, cmaToken });

    logger.debug('Fetching content types');
    const contentTypes = await client.getContentTypes();
    logger.debug('Creating space graph');
    const spaceGraph = await cfGraphql.prepareSpaceGraph(contentTypes);

    const names = spaceGraph.map(ct => ct.names.type).join(', ');
    logger.debug(`Contentful content types prepared: ${names}`);

    logger.info('Creating GraphQL schema');
    const schema = await cfGraphql.createSchema(spaceGraph);

    const opts = { version: true, timeline: true, detailedErrors: false };
    const extension = cfGraphql.helpers.expressGraphqlExtension(client, schema, opts);
    const apiMiddleware = graphqlHTTP(extension);
    middleware.set(eventKey, apiMiddleware);

    return apiMiddleware;
  }
}

async function startServer({ spaceId, cdaToken, hostname, port, basePath }) {
  logger.info(`Starting server at ${hostname}:${port}`);
  const app = express();

  app.use(cors());

  const eventIndex = new EventIndex({ spaceId, cdaToken });

  // This API call will request an entry with the specified ID from the space defined at the top, using a space-specific access token.

  app.get('/event', (req, res, next) => {
    eventIndex.getEvent(req.query.name)
      .then(event => {
        // Hide secrets.
        delete event.secrets;
        res.send(event);
      })
      .catch(next);
  });

  app.get('/:event/graphiql', (req, res) => {
    const ui = cfGraphql.helpers.graphiql({
      title: 'Assembly GraphQL Content',
      url: `${basePath}${req.params.event}/graphql`
    });
    res.set(ui.headers).status(ui.statusCode).end(ui.body)
  });

  app.use('/:event/graphql', (req, res, next) => {
    eventIndex.getEventApi(req.params.event)
      .then(middleware => middleware(req, res, next))
      .catch(next);
  });

  app.listen(port, hostname);
  logger.info('Contentful backend running!');
  logger.info(`You can access GraphiQL at http://${hostname}:${port}/{event}/graphiql/`);
  logger.info(`You can use the GraphQL endpoint at http://${hostname}:${port}/{event}/graphql/`);
}

(async () => {
  const config = getConfig();
  await startServer(config);
})().catch(err => {
  logger.fatal(err.message);
  process.exit(1);
});
