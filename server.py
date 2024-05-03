import json
import sys
import threading
import time
import udi_interface
import os
import subprocess
import signal

LOGGER = udi_interface.LOGGER
Custom = udi_interface.Custom

# Define paths for the configuration file
bin_path = os.path.join(os.path.dirname(__file__), "./bin/")
config_path = os.path.join(bin_path, ".hkisy.config.json")


class Controller(udi_interface.Node):
    def __init__(self, polyglot, primary, address, name):
        super().__init__(polyglot, primary, address, name)
        self.Parameters = Custom(polyglot, "customparams")
        self.name = "HomeKit Bridge Controller"
        self.address = "hkisyctrl"
        self.primary = self.address
        self.configuration = {}
        self.poly = polyglot
        self.process = None

        self.required_params = [
            "isy-host",
            "isy-port",
            "isy-user",
            "isy-password",
            "pin",
            "port",
        ]  # List all required parameters here

        if os.path.exists(config_path):
            LOGGER.info("Configuration file found at {}".format(config_path))
            with open(config_path, "r") as config_file:
                self.configuration = json.load(config_file)
                self.valid_configuration = self.check_configuration(self.configuration)
        else:
            LOGGER.info("Configuration file not found at {}".format(config_path))
            self.valid_configuration = False

        self.poly.subscribe(polyglot.START, self.start, address)
        self.poly.subscribe(polyglot.CUSTOMPARAMS, self.parameter_handler)
        self.poly.subscribe(polyglot.STOP, self.stop)

        self.poly.ready()
        self.poly.addNode(self)

    def parameter_handler(self, params):
        self.poly.Notices.clear()
        self.Parameters.load(params)
        LOGGER.info("parameterHandler called with params: {}".format(params))
        LOGGER.info("Started HomeKit Bridge Controller")

        missing_params = self.check_missing_params(params)
        if missing_params:
            LOGGER.error("Missing parameters: {}".format(", ".join(missing_params)))
            self.poly.Notices["missing_params"] = "Missing parameters: {}".format(
                ", ".join(missing_params)
            )
            self.valid_configuration = False
            return

        # Save the configuration to a file if it has changed
        if self.configuration != params:
            with open(config_path, "w") as config_file:
                json.dump(params, config_file)
                LOGGER.info("Configuration saved to {}".format(config_path))
                self.configuration = params

        self.valid_configuration = True

        return True

    def check_missing_params(self, params):
        return [p for p in self.required_params if p not in params or params[p] is None]

    def check_configuration(self, config):
        return not bool(self.check_missing_params(config))

    def start(self, cmd=None):
        if cmd:
            LOGGER.info("DON ({}): {}".format(cmd.address, cmd.command))
        else:
            LOGGER.info("DON command received with no additional command data")

        if self.process is not None:
            LOGGER.info("HomeKit Bridge process already started")
            return

        while not self.valid_configuration:
            LOGGER.info("Waiting on valid configuration")
            time.sleep(5)

        self.poly.updateProfile()
        self.poly.setCustomParamsDoc()

        command = [os.path.join(bin_path, "hkisy"), "server", "-config", config_path]
        LOGGER.info("Executing command: {}".format(" ".join(command)))
        self.process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,  # Line buffered
        )

        # Log the PID of the subprocess
        LOGGER.info(
            "HomeKit Bridge process started with PID: {}".format(self.process.pid)
        )

        # Check if the process has exited immediately
        if self.process.poll() is not None:
            LOGGER.error(
                "HomeKit Bridge process exited unexpectedly with code: {}".format(
                    self.process.returncode
                )
            )

        def log_stdout():
            for line in iter(self.process.stdout.readline, ""):
                LOGGER.debug(line.strip())

        def log_stderr():
            for line in iter(self.process.stderr.readline, ""):
                LOGGER.error(
                    line.strip()
                )  # Changed to error to capture potential issues

        # Start threads to asynchronously log stdout and stderr
        stdout_thread = threading.Thread(target=log_stdout)
        stdout_thread.start()
        stderr_thread = threading.Thread(target=log_stderr)
        stderr_thread.start()

        self.setDriver("ST", 1)

    def stop(self, cmd=None):
        if cmd:
            LOGGER.info("DOF ({}): {}".format(cmd.address, cmd.command))
        else:
            LOGGER.info("DOF command received with no additional command data")

        if self.process is None:
            LOGGER.info("No HomeKit Bridge process to stop")
            return

        self.process.terminate()
        self.process.wait()
        self.process = None
        self.setDriver("ST", 0)
        LOGGER.info("HomeKit Bridge process stopped")

    def query(self, cmd=None):
        if self.process is None:
            self.setDriver("ST", 0)
        else:
            self.setDriver("ST", 1)

    def discover(self, cmd=None):
        pass

    id = "HKISYCTRL"
    commands = {"QUERY": query, "DON": start, "DOF": stop}
    drivers = [{"driver": "ST", "value": 1, "uom": 2}]

    def child_terminated(self, signum, frame):
        while True:
            try:
                pid, status = os.waitpid(-1, os.WNOHANG)
                if pid == 0:
                    break
                self.setDriver("ST", 0)
                LOGGER.error(
                    f"Child process with PID {pid} terminated with status {status}"
                )
            except ChildProcessError:
                break


if __name__ == "__main__":
    try:
        polyglot = udi_interface.Interface([])
        polyglot.start()
        LOGGER.info("Polyglot interface started")
        ctrl = Controller(
            polyglot, "hkisyctrl", "hkisyctrl", "HomeKit Bridge Controller"
        )
        # Set signal handler for SIGCHLD
        signal.signal(signal.SIGCHLD, ctrl.child_terminated)

        # Just sit and wait for events
        polyglot.runForever()
    except (KeyboardInterrupt, SystemExit):
        sys.exit(0)
