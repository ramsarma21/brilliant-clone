import type { SimKey } from '../../types'
import type { SimProps } from './types'
import { ProjectileSim } from './ProjectileSim'
import { FreeKickExplorer } from './FreeKickExplorer'
import { KinematicsSim } from './KinematicsSim'
import { MotionSim } from './MotionSim'
import { ForcesSim } from './ForcesSim'
import { EnergySim } from './EnergySim'
import { DefenseSim } from './DefenseSim'
import { GoalieSim } from './GoalieSim'

type Props = SimProps & { sim: SimKey }

export function Sim({ sim, ...rest }: Props) {
  switch (sim) {
    case 'projectile':
      return <ProjectileSim {...rest} />
    case 'freekick':
      return <FreeKickExplorer {...rest} />
    case 'soccer':
      return <KinematicsSim {...rest} />
    case 'passing':
      return <MotionSim {...rest} />
    case 'forces':
      return <ForcesSim {...rest} />
    case 'energy':
      return <EnergySim {...rest} />
    case 'defense':
      return <DefenseSim {...rest} />
    case 'goalie':
      return <GoalieSim {...rest} />
    default:
      return null
  }
}
