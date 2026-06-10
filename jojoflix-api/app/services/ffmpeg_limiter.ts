const MAX_CONCURRENT = 3

class FfmpegLimiter {
  private active = 0

  acquire(): boolean {
    if (this.active >= MAX_CONCURRENT) return false
    this.active++
    return true
  }

  release(): void {
    if (this.active > 0) this.active--
  }

  get count(): number {
    return this.active
  }
}

export default new FfmpegLimiter()
