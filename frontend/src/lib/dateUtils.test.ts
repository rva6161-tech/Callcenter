import { describe, expect, it } from 'vitest'
import { addDays, mondayOf, parseISO, toISODate } from './dateUtils'

describe('mondayOf (Monday-snapping week start)', () => {
  it('snaps a mid-week day back to its Monday', () => {
    // 2027-03-03 is a Wednesday -> Monday is 2027-03-01.
    expect(toISODate(mondayOf(parseISO('2027-03-03')))).toBe('2027-03-01')
  })

  it('returns the same day when given a Monday', () => {
    expect(toISODate(mondayOf(parseISO('2027-03-01')))).toBe('2027-03-01')
  })

  it('snaps Sunday back to the preceding Monday (ISO week)', () => {
    // 2027-03-07 is a Sunday -> its ISO-week Monday is 2027-03-01.
    expect(toISODate(mondayOf(parseISO('2027-03-07')))).toBe('2027-03-01')
  })
})

describe('addDays / round-trip helpers', () => {
  it('adds 6 days to a Monday to reach the Sunday of the same week', () => {
    expect(addDays('2027-03-01', 6)).toBe('2027-03-07')
  })

  it('rolls across a month boundary correctly', () => {
    expect(addDays('2027-03-31', 1)).toBe('2027-04-01')
  })

  it('parseISO/toISODate round-trip is stable', () => {
    expect(toISODate(parseISO('2027-12-25'))).toBe('2027-12-25')
  })
})
