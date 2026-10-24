/**
 * @file plugins/game-hub/index.js
 * @description Game-Hub 云崽标准插件入口
 */

import { GameHubDispatcherApp } from "./apps/dispatcher.js";
import { GameHubAdminApp } from "./apps/admin.js";

export const apps = {
  dispatcher: GameHubDispatcherApp,
  admin: GameHubAdminApp
};

export {
  GameHubDispatcherApp,
  GameHubAdminApp
};

export default apps;
