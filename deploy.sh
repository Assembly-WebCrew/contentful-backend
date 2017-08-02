#!/usr/bin/env bash
npm pack
export PACKAGE_NAME=$(ls -t1 | grep *.tgz | head -n 1)
rsync -avPe 'ssh -o StrictHostKeyChecking=no' ./${PACKAGE_NAME} ${TRAVIS_BRANCH}:/opt/contentful-backend/builds/${PACKAGE_NAME}
ssh -o StrictHostKeyChecking=no ${TRAVIS_BRANCH} tar -xzf /opt/contentful-backend/builds/${PACKAGE_NAME} -C /opt/contentful-backend/${TRAVIS_BRANCH} --strip 1
ssh -o StrictHostKeyChecking=no ${TRAVIS_BRANCH} sudo systemctl restart cf-backend-${TRAVIS_BRANCH}
