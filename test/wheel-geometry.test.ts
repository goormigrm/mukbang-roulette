// 룰렛 캔버스 안 배치(roulette.ts wheelGeometry) — 룰렛을 화면 가득 키워도 메뉴명·포인터·원판이 캔버스 안에 들어가는지
import { describe, expect, it } from 'vitest'
import { wheelGeometry } from '../src/roulette'

// 1366 노트북 창(311)부터 2560×1440 전체화면(1101)보다 큰 것까지
const SIZES = [200, 311, 441, 521, 581, 741, 854, 1101, 1600]

describe.each(SIZES)('캔버스 %ipx', (size) => {
  const g = wheelGeometry(size)

  it('원판이 캔버스 안에 들어간다', () => {
    expect(g.cx - g.R).toBeGreaterThanOrEqual(0)
    expect(g.cy + g.R).toBeLessThanOrEqual(size)
    expect(g.cy - g.R).toBeCloseTo(g.rimTop)
  })

  it('포인터 위 메뉴명이 캔버스 위로 잘리지 않는다', () => {
    // 한글 글자 윗선 ≈ 글꼴 크기의 0.92
    expect(g.labelBase - g.labelFont * 0.92).toBeGreaterThanOrEqual(0)
  })

  it('메뉴명 글줄이 포인터(원판 위 22·s)보다 위에 있다', () => {
    expect(g.labelBase).toBeLessThan(g.rimTop - 22 * g.s)
  })

  it('원판이 예전(위쪽 13% 비움)보다 크다', () => {
    const oldR = (size - Math.max(58, size * 0.13)) / 2 - 8
    expect(g.R).toBeGreaterThan(oldR)
  })
})
