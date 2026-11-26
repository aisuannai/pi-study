type Job = {
  run: () => Promise<void>;
};

export class QueueFullError extends Error {}

export class UserQueue {
  private jobs: Job[] = [];
  private draining = false;
  private limit: number;
  private timeoutMs: number;

  constructor(limit: number, timeoutMs: number) {
    this.limit = limit;
    this.timeoutMs = timeoutMs;
  }

  /** 入队一个任务。队列满立即拒绝；排队超时也会拒绝（由 HTTP 层转成错误响应）。 */
  push(run: () => Promise<void>): Promise<void> {
    if (this.jobs.length >= this.limit) {
      return Promise.reject(new QueueFullError(`排队上限 ${this.limit}，请稍后再试`));
    }

    return new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;

      const job: Job = {
        run: async () => {
          if (timer) clearTimeout(timer); // 开始执行：不再受排队超时约束
          try {
            await run();
            resolve();
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
      };

      timer = setTimeout(() => {
        const index = this.jobs.indexOf(job);
        if (index !== -1) this.jobs.splice(index, 1);
        reject(new Error(`排队超过 ${this.timeoutMs}ms，已放弃本次请求`));
      }, this.timeoutMs);

      this.jobs.push(job);
    });
  }

  /** 每次入队后调用一次；保证同一时刻只有一条 drain 循环在跑。 */
  kick(): void {
    if (this.draining) return;
    this.draining = true;
    void (async () => {
      try {
        while (this.jobs.length > 0) {
          const job = this.jobs.shift();
          if (job) await job.run();
        }
      } finally {
        this.draining = false;
      }
    })();
  }
}
