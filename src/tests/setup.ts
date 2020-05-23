import { Probot, createProbot } from 'probot';
import nock from 'nock';
import initApp from '../initApp';
import repoLabels from '../../fixtures/labels.json';

export { nock };

jest.setTimeout(30000);

process.env.REVIEWFLOW_NAME = 'reviewflow-test';
const APP_ID = 1;
nock.disableNetConnect();

export const initializeProbotApp = (): Probot => {
  const probot = createProbot({
    id: APP_ID,
    cert: 'test',
    githubToken: 'test',
  });
  const mockStores = {
    orgs: { findByKey: () => Promise.resolve({ installationId: 1 }) },
    users: { findByKey: () => Promise.resolve({ installationId: 1 }) },
  };
  probot.load((app) => initApp(app, { mongoStores: mockStores } as any));

  return probot;
};

export const mockAccessToken = (): void => {
  nock.disableNetConnect();
  nock('https://api.github.com')
    .post(`/app/installations/${APP_ID}/access_tokens`)
    .reply(200, { token: 'test' });
};

export const mockLabels = (): void => {
  nock('https://api.github.com')
    .get(`/repos/reviewflow/reviewflow-test/labels`)
    .query(true)
    .reply(200, repoLabels);
};
