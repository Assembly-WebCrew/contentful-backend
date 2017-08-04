'use strict';

require('dotenv-safe').load();
const cfGraphql = require('cf-graphql');
const express = require('express');
const { getLogger, getConfig } = require('./utils');
const logger = getLogger('server');
const cors = require('cors');

const EventCache = require('./eventCache');

async function startServer({ space, accessToken, hostname, port, basePath }) {
  logger.info(`Starting server at ${hostname}:${port}`);
  const app = express();

  app.use(cors());

  const events = new EventCache({ space, accessToken });

  // This API call will request an entry with the specified ID from the space defined at the top, using a space-specific access token.

  app.get('/event', (req, res, next) => {
    events.getEvent(req.query.name)
      .then(event => {
        // Hide secrets.
        delete event.secrets;
        res.send(event);
      })
      .catch(next);
  });

  app.get('/:event/schema', (req, res, next) => {
    events.getSchema(req.params.event)
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
    events.getApi(req.params.event)
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
