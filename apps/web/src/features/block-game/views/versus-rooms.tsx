import { ConnectFourBoard } from '../components/connect-four-board';
import { DotsAndBoxesBoard } from '../components/dots-and-boxes-board';
import {
  TIC_TAC_TOE_MARKS,
  TicTacToeBoard,
} from '../components/tic-tac-toe-board';
import { useGamesContext } from '../context/games-context';
import {
  connectFourRules,
  connectFourWinningCells,
} from '../core/games/connect-four';
import { dotsAndBoxesRules, dotsScores } from '../core/games/dots-and-boxes';
import {
  ticTacToeRules,
  ticTacToeWinningLine,
} from '../core/games/tic-tac-toe';
import type { GameRoom } from '../primitives/create-game-room';
import { TurnRoom } from './turn-room';

type RoomProps = { room: GameRoom; documentId: string };

export function TicTacToeRoom(props: RoomProps) {
  return (
    <TurnRoom
      room={props.room}
      documentId={props.documentId}
      kind="tic_tac_toe"
      rules={ticTacToeRules}
      marker={(seat) => TIC_TAC_TOE_MARKS[seat]}
      board={(match) => {
        const phase = match.phase;
        const board = () => {
          const current = phase();
          return current.t === 'lobby'
            ? ticTacToeRules.initial(2, 0).board
            : current.state.board;
        };
        return (
          <TicTacToeBoard
            board={board()}
            winningLine={ticTacToeWinningLine(board())}
            canMove={match.canMove()}
            onMove={(cell) => match.move({ cell })}
          />
        );
      }}
    />
  );
}

export function ConnectFourRoom(props: RoomProps) {
  return (
    <TurnRoom
      room={props.room}
      documentId={props.documentId}
      kind="connect_four"
      rules={connectFourRules}
      board={(match) => {
        const state = () => {
          const current = match.phase();
          return current.t === 'lobby'
            ? connectFourRules.initial(2, 0)
            : current.state;
        };
        return (
          <ConnectFourBoard
            state={state()}
            winningCells={connectFourWinningCells(state())}
            canMove={match.canMove()}
            previewSeat={match.canMove() ? match.mySeat() : undefined}
            onDrop={(column) => match.move({ column })}
          />
        );
      }}
    />
  );
}

export function DotsAndBoxesRoom(props: RoomProps) {
  const games = useGamesContext();
  return (
    <TurnRoom
      room={props.room}
      documentId={props.documentId}
      kind="dots_and_boxes"
      rules={dotsAndBoxesRules}
      detail={(state, seat) => {
        const boxes = dotsScores(state)[seat] ?? 0;
        return boxes === 1 ? '1 box' : `${boxes} boxes`;
      }}
      board={(match) => {
        const state = () => {
          const current = match.phase();
          return current.t === 'lobby'
            ? dotsAndBoxesRules.initial(
                Math.max(2, match.match().seats.length),
                0
              )
            : current.state;
        };
        const initials = () =>
          match
            .match()
            .seats.map((userId) =>
              (games.displayName(userId).trim()[0] ?? '?').toUpperCase()
            );
        return (
          <DotsAndBoxesBoard
            state={state()}
            canMove={match.canMove()}
            turnSeat={match.canMove() ? match.mySeat() : undefined}
            initials={initials()}
            onDraw={(move) => match.move(move)}
          />
        );
      }}
    />
  );
}
