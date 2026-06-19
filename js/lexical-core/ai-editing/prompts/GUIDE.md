```ts
$byId(s, 'b2').remove()
$blockById(s, 'b1').getChildren()
$allById(s, ['b2', 'b3'])
$getText($blockById(s, 'b2'))

$modifyNode(s, 'b14', { op: 'blockType', block: 'heading', level: 2 })
$modifyNode(s, 'b2', { op: 'text', text: 'The launch is behind schedule.' })
$modifyNode(s, 'i9', { op: 'listType', list: 'number' })
$modifyNode(s, 'n1', { op: 'checked', checked: true })
$modifyNode(s, 'b16', { op: 'indent', indent: 'in' })

$setText($blockById(s, 'b2'), 'The launch is behind schedule.')

const h2 = $createHeadingNode('h2'); h2.append($createTextNode('Status'))
const p = $createParagraphNode(); p.append($createTextNode('Behind schedule.'))
$replaceBlock($blockById(s, 'b2'), h2, p)

$insertAfter($blockById(s, 'b7'), $createHeadingNode('h2'))
$insertBefore($blockById(s, 'b1'), $createParagraphNode())
$appendBlock(s, $createParagraphNode())
$prependBlock(s, $createHeadingNode('h1'))

$moveBlock($byId(s, 'b16'), { afterId: 'b6' })
$mergeBlocks($allById(s, ['b2', 'b3']))
$splitBlock($blockById(s, 'b8'), 'Second,')

$createTextNode('word').toggleFormat('bold')
$createTextNode('word').toggleFormat('italic')
$createTextNode('word').toggleFormat('underline')

$replaceTextInBlock($blockById(s, 'b5'), 'frog', () => $createTextNode('toad').toggleFormat('bold'), { all: true })
$formatTextInBlock($blockById(s, 'b5'), 'Bluejay', 'bold', { all: true })
$setAllFormat($blockById(s, 'b5'), 'bold')
$setAllFormat($blockById(s, 'b5'))
$clearFormat($blockById(s, 'b5'), 'Bluejay', 'bold', { all: true })
$replaceString($blockById(s, 'b5'), 'Q3', 'Q4', { all: true })
$appendText($blockById(s, 'b1'), ' (draft)')
$prependText($blockById(s, 'b1'), 'DRAFT: ')

$toggleList($allById(s, ['b11', 'b12']), 'check')
$sortList($byId(s, 'b16'))

$blockById(s, 'b7').insertAfter($table([['Fruit', 'Taste'], ['Apple', 'Sweet']]))
$setCell($byId(s, 'tableId'), 1, 0, 'Banana')

$insertAfter($blockById(s, 'b3'), $createHorizontalRuleNode())
$insertAfter($blockById(s, 'b3'), $createImageNode({ srcType: 'url', url: 'https://example.com/cat.png', alt: 'a cat' }))
$insertAfter($blockById(s, 'b3'), $createVideoNode({ srcType: 'url', url: 'https://example.com/clip.mp4' }))
$blockById(s, 'b1').append($createDateMentionNode({ date: '2026-06-18T00:00:00.000Z', displayFormat: 'june 18' }))

const p2 = $createParagraphNode()
p2.append($createTextNode('line one'), $createLineBreakNode(), $createTextNode('line two'))
$insertAfter($blockById(s, 'b3'), p2)
```
