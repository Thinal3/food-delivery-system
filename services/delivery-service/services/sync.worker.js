const repository = require('../repositories/delivery.repository');
const orderClient = require('./order.client');
const { syncPollIntervalMs, syncMaxAttempts } = require('../config/env');

let timer;
let active = false;
let stopped = false;

async function processOne() {
  if (active || stopped) return;
  active = true;
  try {
    const task = await repository.claimNextSyncTask();
    if (!task) return;
    try {
      await orderClient.updateOrderStatusFromDelivery(
        Number(task.order_id), Number(task.delivery_id), task.target_status,
      );
      await repository.markSyncSucceeded(task.id);
    } catch (error) {
      await repository.markSyncFailed(task, error.statusCode || 503, syncMaxAttempts);
    }
  } catch {
    // Polling errors are retried on the next interval; never log tokens or SQL detail.
  } finally {
    active = false;
  }
}

function startSyncWorker() {
  stopped = false;
  timer = setInterval(processOne, syncPollIntervalMs);
  timer.unref();
  void processOne();
}

function stopSyncWorker() {
  stopped = true;
  if (timer) clearInterval(timer);
}

module.exports = { startSyncWorker, stopSyncWorker, processOne };