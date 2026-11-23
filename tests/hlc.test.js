import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { nextTs, observe, lastTs, _reset, MAX_DRIFT } from '../js/hlc.js';
beforeEach(_reset);

test('同一毫秒内连续写入严格递增', () => {
  const a = nextTs(1000), b = nextTs(1000), c = nextTs(1000);
  assert.ok(a < b && b < c);
});
test('吸收远端时间戳后，本地新写入晚于它', () => {
  observe(5000, 4000);
  assert.ok(nextTs(4000) > 5000);
});
test('时钟回拨时仍保持单调', () => {
  const a = nextTs(9000);
  assert.ok(nextTs(1000) > a);
});
test('远端时间戳超前超过 MAX_DRIFT 视为异常，不吸收', () => {
  observe(1000 + MAX_DRIFT + 1, 1000);
  assert.equal(lastTs(), 0);
  observe('abc');
  assert.equal(lastTs(), 0);
});
