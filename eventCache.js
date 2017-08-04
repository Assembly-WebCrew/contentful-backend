const { getLogger } = require('./utils');
const logger = getLogger('eventCache');

const { cloneDeep } = require('lodash');

const contentful = require('contentful');
const { graphql } = require('graphql');
const cfGraphql = require('cf-graphql');
const graphqlHTTP = require('express-graphql');

const LifetimeCache = require('./lifetimeCache');

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
    this.cache = new LifetimeCache(120000);
  }

  _getEventKey(eventName) {
    return eventName ? eventName : this.defaultEvent;
  }

  _getEventCache(key) {
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    const cache = new Map();
    this.cache.set(key, cache);
    return cache;
  }

  async getEvent(eventName) {
    const key = this._getEventKey(eventName);
    const options = { content_type: 'event', limit: 1 };

    if (eventName) {
      options['fields.name'] = eventName;
    } else {
      options['fields.isDefault'] = true;
    }

    if (this._getEventCache(key).has('data')) {
      const data = cloneDeep(this._getEventCache(key).get('data'));
      logger.debug(`Found cached event ${data.name}`);
      return data;
    }

    const entries = await this.client.getEntries(options);
    const data = entries.items[0].fields;
    this._getEventCache(key).set('data', cloneDeep(data));
    logger.debug(`Fetched event ${data.name}`);
    return data;
  }

  // TODO: Remove locale specific middleware once https://github.com/contentful-labs/cf-graphql/issues/29 has been resolved.
  async getApi(eventName, locale) {
    const key = this._getEventKey(eventName);

    if (this._getEventCache(key).has(`${locale}_middleware`)) {
      logger.debug(`Returning cached middleware for ${key}`);
      return this._getEventCache(key).get(`${locale}_middleware`);
    }

    logger.info(`Creating GraphQL middleware for ${key}`);

    const eventData = await this.getEvent(key);
    const { spaceId, cdaToken, cmaToken } = eventData.secrets;

    logger.debug(`Fetching content types for space (${spaceId}) to create a space graph`);
    logger.debug(`Initializing contentful client for space ${spaceId}`);
    logger.trace(`Configuration: ${JSON.stringify({ spaceId, cdaToken, cmaToken })}`);
    const client = cfGraphql.createClient({ spaceId, cdaToken, cmaToken, locale });

    logger.debug('Fetching content types');
    const contentTypes = await client.getContentTypes();
    logger.debug('Creating space graph');
    const spaceGraph = await cfGraphql.prepareSpaceGraph(contentTypes);

    const names = spaceGraph.map(ct => ct.names.type).join(', ');
    logger.debug(`Contentful content types prepared: ${names}`);

    logger.debug('Creating GraphQL schema');
    const schema = await cfGraphql.createSchema(spaceGraph);
    const introspection = (await graphql(schema, introspectionQuery)).data;
    this._getEventCache(key).set('schema', introspection);

    const middleware = graphqlHTTP(cfGraphql.helpers.expressGraphqlExtension(client, schema, {
      version: true,
      timeline: true,
      detailedErrors: false
    }));
    this._getEventCache(key).set(`${locale}_middleware`, middleware);

    return middleware;
  }

  async getSchema(eventName) {
    const key = this._getEventKey(eventName);
    if (!this._getEventCache(key).has('schema')) {
      await this.getApi(key);
    }
    return this._getEventCache(key).get('schema');
  }
}

module.exports = EventCache;
