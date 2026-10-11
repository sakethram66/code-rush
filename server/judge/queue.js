'use strict';
// Small bounded-concurrency FIFO queue. Jobs are async functions; enqueue() resolves with the job's result.
class JudgeQueue {
  constructor(concurrency = 2) {
    this.concurrency = Math.max(1, concurrency);
    this.pending = [];
    this.active = 0;
    this.idleWaiters = [];
    this.closed = false;
  }
  enqueue(job) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('Judge queue is closed'));
      this.pending.push({ job, resolve, reject });
      this._pump();
    });
  }
  _pump() {
    while (this.active < this.concurrency && this.pending.length) {
      const { job, resolve, reject } = this.pending.shift();
      this.active++;
      Promise.resolve().then(job).then(resolve, reject).finally(() => {
        this.active--;
        this._pump();
        if (!this.active && !this.pending.length) {
          const w = this.idleWaiters; this.idleWaiters = [];
          w.forEach((f) => f());
        }
      });
    }
  }
  stats() { return { queued: this.pending.length, active: this.active, concurrency: this.concurrency }; }
  idle() {
    if (!this.active && !this.pending.length) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }
  close() { this.closed = true; }
}
module.exports = { JudgeQueue };
