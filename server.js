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
const { graphql } = require('graphql');

// Cache.
const eventCache = new Map();
const defaultEvent = Symbol('default event');
const introspectionQuery = `{
  __schema {
    types {
      kind
      name
      possibleTypes {
        name
      }
    }
  }
}`;

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

    if (eventCache.has(eventKey)) {
      const eventData = cloneDeep(eventCache.get(eventKey).get('eventData'));
      logger.debug(`Found event ${eventData.name}`);
      return eventData;
    } else {
      const entries = await this.client.getEntries(options);
      const eventData = entries.items[0].fields;
      eventCache.set(eventKey, new Map([['eventData', cloneDeep(eventData)]]));
      logger.debug(`Found event ${eventData.name}`);
      return eventData;
    }
  }

  async getEventApi(name) {
    const eventKey = this.getEventKey(name);

    if (!eventCache.has(eventKey)) {
      await this.getEvent(eventKey);
    }

    const eventApi = eventCache.get(eventKey);

    if (eventApi.has('middleware')) {
      return eventApi.get('middleware');
    }

    const { spaceId, cdaToken, cmaToken } = (await this.getEvent(name)).secrets;

    logger.info(`Fetching content types for space (${spaceId}) to create a space graph`);
    logger.debug(`Initializing contentful client for space ${spaceId}`);
    logger.trace(`Configuration: ${JSON.stringify({ spaceId, cdaToken, cmaToken })}`);
    const client = cfGraphql.createClient({ spaceId, cdaToken, cmaToken });

    logger.debug('Fetching content types');
    const contentTypes = await client.getContentTypes();
    logger.debug('Creating space graph');
    const spaceGraph = await cfGraphql.prepareSpaceGraph(contentTypes);

    const names = spaceGraph.map(ct => ct.names.type).join(', ');
    logger.debug(`Contentful content types prepared: ${names}`);

    logger.info('Creating GraphQL schema');
    const schema = await cfGraphql.createSchema(spaceGraph);
    const schemaIntrospection = (await graphql(schema, introspectionQuery)).data;
    eventApi.set('schema', schemaIntrospection);
    const opts = { version: true, timeline: true, detailedErrors: false };
    const extension = cfGraphql.helpers.expressGraphqlExtension(client, schema, opts);
    const apiMiddleware = graphqlHTTP(extension);
    eventApi.set('middleware', apiMiddleware);

    return apiMiddleware;
  }

  async getEventSchema(eventKey) {
    if (!eventCache.has(eventKey)) {
      await this.getEventApi(eventKey);
    }
    return eventCache.get(eventKey).get('schema');
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

  app.get('/:event/schema', (req, res, next) => {
    eventIndex.getEventSchema(req.params.event)
      .then(schema => {
        return res.send(schema)
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
