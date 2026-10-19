// Startup file for cPanel "Setup Node.js App" (Passenger loads apps with require()).
process.chdir(__dirname);
import("./src/server.js");
