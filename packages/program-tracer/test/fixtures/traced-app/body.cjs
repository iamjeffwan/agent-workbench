'use strict';

class Probe {
  echo(value) {
    return value;
  }

  async outer(value) {
    return this.inner(value);
  }

  async inner(value) {
    if (value.fail) {
      throw new Error('Authorization: Bearer abc.def.ghi');
    }
    return { ok: true, content: value.content };
  }
}

module.exports = { Probe };
