import { useGoToLocation } from '@block-pdf/signal/tab';
// import { useCreateTab, useOpenLocation, useTabsValue } from '@app/atoms/tab';
import ArrowSquareOut from '@icon/regular/arrow-square-out.svg';
import { styled } from 'solid-styled-components';
import type Reference from '../../model/Reference';
import type Term from '../../model/Term';

const IconContainer = styled.div`
  flex-basis: 28px;
  width: 28px;
  min-width: 28px;
  justify-content: right;
  line-height: 0px;
`;

interface IProps {
  term: Term;
  reference: Reference | Term;
}
export function OpenRefInNewTabIcon(props: IProps) {
  const goToLocation = useGoToLocation();

  return (
    <IconContainer>
      {/* <Tooltip placement={'bottom'} label={'Open'} small={true}> */}
      <span class="flex">
        <ArrowSquareOut
          on:click={() => {
            goToLocation({
              pageIndex: props.reference.pageNum,
              yPos: props.reference.yPos,
              callout: 40,
              newTab: true,
            });
          }}
          style={{
            cursor: 'var(--cursor-pointer)',
            'margin-left': '5px',
            width: '1.5em',
            height: '1.5em',
          }}
          class="icon"
        />
      </span>
      {/* </Tooltip> */}
    </IconContainer>
  );
}
