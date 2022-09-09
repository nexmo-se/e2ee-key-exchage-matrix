// based in olm group_demo.js sample 

export { OTOlmUser as OTOlmUser };

function OTOlmUser(name) {
    this.name = name;
    this.olmAccount = new Olm.Account();
    this.olmAccount.create();

    this.idKey = this.getIdKeys()["curve25519"];
}

OTOlmUser.prototype.getIdKeys = function() {
    return JSON.parse(this.olmAccount.identity_keys());
};

OTOlmUser.prototype.getOneTimeKey = function() {
    var self = this;
    self.olmAccount.generate_one_time_keys(1);
    var keys = JSON.parse(self.olmAccount.one_time_keys()).curve25519;
    for (var key_id in keys) {
        if (keys.hasOwnProperty(key_id)) {
            self.olmAccount.mark_keys_as_published();
            return keys[key_id];
        }
    }
    throw new Error("No one-time-keys generated");
};

document.addEventListener("DOMContentLoaded", function() {
  Olm.init().then(function() {
    console.log("Olm initialized");
  });
}, false);
