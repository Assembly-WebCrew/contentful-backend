const { getLogger } = require('./utils');
const logger = getLogger('eventCache');

const { cloneDeep } = require('lodash');

const contentful = require('contentful');
const { graphql } = require('graphql');
const cfGraphql = require('cf-graphql');
const graphqlHTTP = require('express-graphql');

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

class EventCache {
  constructor({ space, accessToken }) {
    this.client = contentful.createClient({ space, accessToken });
    this.defaultEvent = Symbol('default event');
    this.dataCache = new Map();
    this.schemaCache = new Map();
    this.middlewareCache = new Map();
  }

  _getEventKey(eventName) {
    return eventName ? eventName : this.defaultEvent;
  }

  async getEvent(eventName) {
    const key = this._getEventKey(eventName);
    const options = { content_type: 'event', limit: 1 };

    if (eventName) {
      options['fields.name'] = eventName;
    } else {
      options['fields.isDefault'] = true;
    }

    if (this.dataCache.has(key)) {
      const data = cloneDeep(this.dataCache.get(key));
      logger.debug(`Found cached event ${data.name}`);
      return data;
    }

    const entries = await this.client.getEntries(options);
    const data = entries.items[0].fields;
    this.dataCache.set(key, cloneDeep(data));
    logger.debug(`Fetched event ${data.name}`);
    return data;
  }

  async getApi(eventName) {
    const key = this._getEventKey(eventName);

    if (this.middlewareCache.has(key)) {
      logger.debug(`Returning cached middleware for ${key}`);
      return this.middlewareCache.get(key);
    }

    logger.info(`Creating GraphQL middleware for ${key}`);

    const eventData = await this.getEvent(key);
    const { spaceId, cdaToken, cmaToken } = eventData.secrets;

    logger.debug(`Fetching content types for space (${spaceId}) to create a space graph`);
    logger.debug(`Initializing contentful client for space ${spaceId}`);
    logger.trace(`Configuration: ${JSON.stringify({ spaceId, cdaToken, cmaToken })}`);
    const client = cfGraphql.createClient({ spaceId, cdaToken, cmaToken });

    logger.debug('Fetching content types');
    const contentTypes = await client.getContentTypes();
    logger.debug('Creating space graph');
    const spaceGraph = await cfGraphql.prepareSpaceGraph(contentTypes);

    const names = spaceGraph.map(ct => ct.names.type).join(', ');
    logger.debug(`Contentful content types prepared: ${names}`);

    logger.debug('Creating GraphQL schema');
    const schema = await cfGraphql.createSchema(spaceGraph);
    const introspection = (await graphql(schema, introspectionQuery)).data;
    this.schemaCache.set(key, introspection);

    const middleware = graphqlHTTP(cfGraphql.helpers.expressGraphqlExtension(
      client,
      schema,
      {
        version: true,
        timeline: true,
        detailedErrors: false
      }
    ));
    this.middlewareCache.set(key, middleware);

    return middleware;
  }

  async getSchema(eventName) {
    const key = this._getEventKey(eventName);
    if (!this.schemaCache.has(key)) {
      await this.getApi(key);
    }
    return this.schemaCache.get(key);
  }
}

module.exports = EventCache;
