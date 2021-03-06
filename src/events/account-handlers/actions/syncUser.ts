import type { MongoStores, User } from '../../../mongo';
import type { Octokit } from '../../../octokit';

interface UserInfo {
  login: string;
  id: number;
}

export const syncUser = async (
  mongoStores: MongoStores,
  github: Octokit,
  installationId: number,
  userInfo: UserInfo,
): Promise<User> => {
  const user = await mongoStores.users.upsertOne({
    _id: userInfo.id,
    login: userInfo.login,
    type: 'User',
    installationId,
  });

  return user;
};
