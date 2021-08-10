'use strict';

const spawn = require('child_process').spawn;
const path = require('path');
const binPath = path.join(__dirname, '../', 'bin/');
const delay = ms => new Promise(_ => setTimeout(_, ms));

module.exports = function(Polyglot) {
  const logger = Polyglot.logger;

  class HomeKitBridge {
    constructor() {
      logger.info('HomeKitBridge => constructor hit');
      this.shouldRestart = false;
      this.instance = null;
    }

    async start() {
      logger.debug('HomeKitBridge => start invoked');
      if (this.isStarted()) {
        return;
      }

      logger.debug("HomeKitBridge => starting instance")
      const _this = this;
      this.shouldRestart = true;
      this.instance = spawn(binPath + 'hkisy', ['server', '-config', binPath + '.hkisy.config.json']);

      this.instance.stdout.on('data', function(data) {
        logger.info(`STDOUT: ${data.toString()}`);
      });

      this.instance.stderr.on('data', function(data) {
        logger.info(`STDERR: ${data.toString()}`);
      });

      this.instance.on('close', function() {
        logger.info('hkisy process has closed.');
        if (_this.shouldRestart) {
          logger.info('restarting hkisy process');
          _this.start();
        }
      });
    }

    async stop() {
      if (!this.isStarted()) {
        return;
      }

      this.shouldRestart = false;
      this.instance.kill('SIGTERM');
      await delay(3000);
      this.instance = null;
    }

    isStarted() {
      return this.instance !== undefined && this.instance !== null;
    }
  }

  return new HomeKitBridge();
};


