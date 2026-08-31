/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerHeadlessTask('SmsTask', () => require('./src/services/smsTask').default);
AppRegistry.registerComponent(appName, () => App);
