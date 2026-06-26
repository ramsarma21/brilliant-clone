import type { UnitStatus } from '../types'
import { supabase } from './supabase'
import { DEMO_PROFILE } from './storage'

type MasteryPayload = {
  kinematics_mastered: boolean
  motion_graphs_mastered: boolean
  forces_mastered: boolean
  energy_mastered: boolean
  circuits_mastered: boolean
  momentum_mastered: boolean
  impulse_mastered: boolean
}

export function unitStatusToProfileMastery(unitStatus: Record<string, UnitStatus>): MasteryPayload {
  return {
    kinematics_mastered: unitStatus.kinematics === 'mastered',
    motion_graphs_mastered: unitStatus['motion-graphs'] === 'mastered',
    forces_mastered: unitStatus.forces === 'mastered',
    energy_mastered: unitStatus.energy === 'mastered',
    circuits_mastered: unitStatus.circuits === 'mastered',
    momentum_mastered: unitStatus.momentum === 'mastered',
    impulse_mastered: unitStatus.impulse === 'mastered',
  }
}

export async function saveProfileMastery(
  unitStatus: Record<string, UnitStatus>,
  username: string = DEMO_PROFILE.username,
): Promise<void> {
  const payload = unitStatusToProfileMastery(unitStatus)
  try {
    await supabase
      .from('profiles')
      .upsert(
        {
          username,
          display_name: DEMO_PROFILE.displayName,
          ...payload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'username' },
      )
  } catch {
    // Local progress is still the source of truth while developing/offline.
  }
}
