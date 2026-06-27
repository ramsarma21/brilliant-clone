import type { UnitStatus } from '../types'
import { supabase } from './supabase'

// Only the five offered units have mastery columns. (circuits + impulse were
// removed — referencing those non-existent columns in the upsert payload made
// the whole write fail, which is why resets never cleared the flags.)
type MasteryPayload = {
  kinematics_mastered: boolean
  motion_graphs_mastered: boolean
  forces_mastered: boolean
  energy_mastered: boolean
  momentum_mastered: boolean
}

export function unitStatusToProfileMastery(unitStatus: Record<string, UnitStatus>): MasteryPayload {
  return {
    kinematics_mastered: unitStatus.kinematics === 'mastered',
    motion_graphs_mastered: unitStatus['motion-graphs'] === 'mastered',
    forces_mastered: unitStatus.forces === 'mastered',
    energy_mastered: unitStatus.energy === 'mastered',
    momentum_mastered: unitStatus.momentum === 'mastered',
  }
}

export async function saveProfileMastery(
  unitStatus: Record<string, UnitStatus>,
  username: string,
): Promise<void> {
  if (!username) return
  const payload = unitStatusToProfileMastery(unitStatus)
  try {
    await supabase
      .from('profiles')
      .upsert(
        {
          username,
          ...payload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'username' },
      )
  } catch {
    // Local progress is still the source of truth while developing/offline.
  }
}
