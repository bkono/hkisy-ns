'use strict';

trapUncaughExceptions();

const fs = require('fs');
const markdown = require('markdown').markdown; // For Polyglot-V2 only
const AsyncLock = require('async-lock');

// Load polyinterface, this NS is on-prem only.
const Polyglot = require('polyinterface');

// Use logger.<debug|info|warn|error>()
// Logs to <home>/.polyglot/nodeservers/<your node server>/logs/<date>.log
// To watch logs: tail -f ~/.polyglot/nodeservers/<NodeServer>/logs/<date>.log
// All log entries prefixed with NS: Comes from your NodeServer.
// All log entries prefixed with POLY: Comes from the Polyglot interface
const logger = Polyglot.logger;
const lock = new AsyncLock({timeout: 500});

// Those are the node definitions that our nodeserver uses.
// You will need to edit those files.
const delay = ms => new Promise(_ => setTimeout(_, ms));

const hkBridge = require('./lib/HomeKitBridge')(Polyglot);
logger.info('hkBridge required: [ ' + hkBridge + ' ]');
const ControllerNode = require('./Nodes/ControllerNode.js')(Polyglot, callAsync, createHomeKitStatusNode);
const HomeKitBridgeNode = require('./Nodes/HomeKitBridgeNode.js')(Polyglot, bridgeStart, bridgeStop, bridgeIsStarted);

const path = require('path');
const binPath = path.join(__dirname, './bin/');
const confFile = '.hkisy.config.json';
const confFilePath = binPath + confFile;

// UI Parameters: typedParams - Feature available in Polyglot-V2 only:
// Custom parameters definitions in front end UI configuration screen
// You can use this instead of customParams to handle typed nodeserver params
// Accepts list of objects with the following properties:
// name - used as a key when data is sent from UI
// title - displayed in UI
// defaultValue - optional
// type - optional, can be 'NUMBER', 'STRING' or 'BOOLEAN'. Defaults to 'STRING'
// desc - optional, shown in tooltip in UI
// isRequired - optional, true/false
// isList - optional, true/false, if set this will be treated as list of values
//    or objects by UI
// params - optional, can contain a list of objects.
// 	 If present, then this (parent) is treated as object /
// 	 list of objects by UI, otherwise, it's treated as a
// 	 single / list of single values

const typedParams = [
  {name: 'isy-host', title: 'ISY Host', isRequired: true},
  {name: 'isy-user', title: 'ISY User', isRequired: true},
  {name: 'isy-password', title: ' ISY Password', isRequired: true},
  {name: 'port', title: 'Port', isRequired: true, type: 'NUMBER'},
  {name: 'pin', title: 'Pin', isRequired: true},
];

logger.info('Starting Node Server');

// Create an instance of the Polyglot interface. We need pass all the node
// classes that we will be using.
const poly = new Polyglot.Interface([ControllerNode, HomeKitBridgeNode]);

// Connected to MQTT, but config has not yet arrived.
poly.on('mqttConnected', function() {
  logger.info('MQTT Connection started');
});

let currentConfig = {};
if (fs.existsSync(confFilePath)) {
  currentConfig = fs.readFileSync(confFilePath);
}

// Config has been received
poly.on('config', async function(config) {
  const nodesCount = Object.keys(config.nodes).length;
  logger.info('Config received has %d nodes', nodesCount);

  // If this is the first config after a node server restart
  if (config.isInitialConfig) {
    // Removes all existing notices on startup.
    poly.removeNoticesAll();

    logger.info('Running nodeserver on-premises');

    // Sets the configuration fields in the UI / Available in Polyglot V2 only
    poly.saveTypedParams(typedParams);

    // Sets the configuration doc shown in the UI
    // Available in Polyglot V2 only
    const md = fs.readFileSync('./configdoc.md');
    poly.setCustomParamsDoc(markdown.toHTML(md.toString()));

    // If we have no nodes yet, we add the first node: a controller node which
    // holds the node server status and control buttons The first device to
    // create should always be the nodeserver controller.
    if (!nodesCount) {
      try {
        logger.info('Auto-creating controller node');
        callAsync(autoCreateController());
      } catch (err) {
        logger.error('Error while auto-creating controller node:', err);
      }
    }
  }

  if (config.newParamsDetected) {
    logger.info('new config params detected');
    // this doesn't seem to be working for typed params
  }

  logger.debug('config => checking for valid config');
  if (isValidConfig(config.typedCustomData)) {
    logger.debug('config => typeCustomData is valid config, let\'s use it');
    const typedData = JSON.stringify(config.typedCustomData);
    if (currentConfig !== typedData) {
      logger.debug('config => typedCustomData is different than current config');
      logger.info('config => writing update to ' + confFile);
      currentConfig = typedData;
      fs.writeFileSync(confFilePath, currentConfig);
      await bridgeStop();
      await bridgeStart();
    }
  }
});

function isValidConfig(conf) {
  if (!conf) {
    logger.debug('config not yet valid');
    return false;
  }

  const keys = Object.keys(conf);
  return typedParams.every(p => {
    if (!p.isRequired) {
      return true;
    }
    return keys.includes(p.name);
  });
}

// This is triggered every x seconds. Frequency is configured in the UI.
poly.on('poll', function(longPoll) {
  callAsync(doPoll(longPoll));
});

// Received a 'stop' message from Polyglot. This NodeServer is shutting down
poly.on('stop', async function() {
  logger.info('Graceful stop');
  await doPoll(false);
  await doPoll(true);
  await bridgeStop();

  poly.stop();
});

// Received a 'delete' message from Polyglot. This NodeServer is being removed
poly.on('delete', async function() {
  logger.info('Nodeserver is being deleted');

  await bridgeStop();
  poly.stop();
});

// MQTT connection ended
poly.on('mqttEnd', function() {
  logger.info('MQTT connection ended.'); // May be graceful or not.
});

// Triggered for every message received from polyglot.
poly.on('messageReceived', function(message) {
  // Only display messages other than config
  if (!message['config']) {
    logger.debug('Message Received: %o', message);
  }
});

// Triggered for every message sent to polyglot.
poly.on('messageSent', function(message) {
  logger.debug('Message Sent: %o', message);
});

// This is being triggered based on the short and long poll parameters in the UI
async function doPoll(longPoll) {
  // Prevents polling logic reentry if an existing poll is underway
  try {
    await lock.acquire('poll', function() {
      logger.info('%s', longPoll ? 'Long poll' : 'Short poll');
    });
  } catch (err) {
    logger.error('Error while polling: %s', err.message);
  }
}

// Creates the controller node
async function autoCreateController() {
  try {
    await poly.addNode(
      new ControllerNode(poly, 'controller', 'controller', 'HomeKit NodeServer'),
    );
  } catch (err) {
    logger.error('Error creating controller node');
  }

  // Add a notice in the UI for 5 seconds
  poly.addNoticeTemp('newController', 'Controller node initialized', 5);
}


async function createHomeKitStatusNode(primaryAddress) {
  logger.debug('onCreateNew => invoked');
  const homekitNodeAddress = 'hk001';
  const node = poly.getNode(homekitNodeAddress);
  if (node) {
    logger.debug('node present, deleting to allow full recreation');
    await poly.delNode(node);
    await delay(3000);
  }

  try {
    const nodeName = 'HomeKit Bridge';
    const homeKitNode = new HomeKitBridgeNode(
      poly,
      primaryAddress,
      homekitNodeAddress,
      nodeName);
    const result = await poly.addNode(homeKitNode);
    logger.info('HomeKit Bridge Node added: %s', result);
    poly.addNoticeTemp('newHomeKitBridgeNode', 'HomeKit Bridge Node initialized', 5);
    await homeKitNode.query();
  } catch (err) {
    logger.errorStack(err, 'Add node failed:');
  }
}

async function bridgeStart() {
  return hkBridge.start();
}

async function bridgeStop() {
  return hkBridge.stop();
}

function bridgeIsStarted() {
  return hkBridge.isStarted();
}

// Call Async function from a non-asynch function without waiting for result,
// and log the error if it fails
function callAsync(promise) {
  (async function() {
    try {
      await promise;
    } catch (err) {
      logger.error('Error with async function: %s %s', err.message, err.stack);
    }
  })();
}

function trapUncaughExceptions() {
  // If we get an uncaugthException...
  process.on('uncaughtException', function(err) {
    console.log(`uncaughtException REPORT THIS!: ${err.stack}`);
  });
}

// Starts the NodeServer!
poly.start();
