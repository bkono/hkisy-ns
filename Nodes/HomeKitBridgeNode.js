'use strict';

// This is an example NodeServer Node definition.
// You need one per nodedefs.

// nodeDefId must match the nodedef id in your nodedef
const nodeDefId = 'HK';

module.exports = function(Polyglot, bridgeStart, bridgeStop, bridgeIsStarted) {
// Utility function provided to facilitate logging.
  const logger = Polyglot.logger;

  // This is your custom Node class
  class HomeKitBridgeNode extends Polyglot.Node {

    // polyInterface: handle to the interface
    // address: Your node address, withouth the leading 'n999_'
    // primary: Same as address, if the node is a primary node
    // name: Your node name
    constructor(polyInterface, primary, address, name) {
      logger.info('HomeKit Node => constructing one');
      super(nodeDefId, polyInterface, primary, address, name);

      logger.debug("saving bridgeIsStarted")

      // Commands that this node can handle.
      // Should match the 'accepts' section of the nodedef.
      this.commands = {
        // You can use the query function from the base class directly
        DON: this.onStart,
        DOF: this.onStop,
        QUERY: this.query,
      };

      // Status that this node has.
      // Should match the 'sts' section of the nodedef.
      this.drivers = {
        ST: {value: '1', uom: 2},
        GV0: {value: '', uom: 25},
      };
    }

    async onStart() {
      logger.debug("HomeKit Node => onStart invoked")
      await bridgeStart()
      await this.query()
    }

    async onStop() {
      logger.debug("HomeKit Node => onStart invoked")
      await bridgeStop()
      await this.query()
    }

    async query() {
      logger.debug('HomeKit Node => onQuery invoked');
      if (bridgeIsStarted()) {
        this.setDriver('GV0', 1, true);
      } else {
        this.setDriver('GV0', 0, true);
      }
    }

  }

  // Required so that the interface can find this Node class using the nodeDefId
  HomeKitBridgeNode.nodeDefId = nodeDefId;

  return HomeKitBridgeNode;
};


// Those are the standard properties of every nodes:
// this.id              - Nodedef ID
// this.polyInterface   - Polyglot interface
// this.primary         - Primary address
// this.address         - Node address
// this.name            - Node name
// this.timeAdded       - Time added (Date() object)
// this.enabled         - Node is enabled?
// this.added           - Node is addeto ISY?
// this.commands        - List of allowed commands
//                        (You need to define them in your custom node)
// this.drivers         - List of drivers
//                        (You need to define them in your custom node)

// Those are the standard methods of every nodes:
// Get the driver object:
// this.getDriver(driver)

// Set a driver to a value (example set ST to 100)
// this.setDriver(driver, value, report=true, forceReport=false, uom=null)

// Send existing driver value to ISY
// this.reportDriver(driver, forceReport)

// Send existing driver values to ISY
// this.reportDrivers()

// When we get a query request for this node.
// Can be overridden to actually fetch values from an external API
// this.query()

// When we get a status request for this node.
// this.status()
