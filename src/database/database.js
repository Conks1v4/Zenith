const fs = require("fs");
const path = require("path");

const databasePath = path.join(
  __dirname,
  "../../data/database.json"
);

function ensure() {
  const directory = path.dirname(databasePath);

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, {
      recursive: true
    });
  }

  if (!fs.existsSync(databasePath)) {
    fs.writeFileSync(
      databasePath,
      JSON.stringify(
        {
          servers: {}
        },
        null,
        2
      )
    );
  }
}

function load() {
  ensure();

  return JSON.parse(
    fs.readFileSync(databasePath, "utf8")
  );
}

function save(data) {
  ensure();

  fs.writeFileSync(
    databasePath,
    JSON.stringify(data, null, 2)
  );
}

module.exports = {
  load,
  save
};
