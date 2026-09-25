(() => {
  const button = document.getElementById('workflow-run');
  const status = document.getElementById('workflow-status');
  const map = document.querySelector('.execution-map');
  let step = 0;
  const stages = [
    { nodes: ['inventory', 'credit'], text: 'Inventory available. Credit limit exceeded. Finance approval required.', button: 'Simulate finance approval', state: 'review' },
    { nodes: ['inventory', 'credit', 'approval', 'fulfill', 'invoice'], text: 'Approval recorded. Fulfillment released and invoice created in the source systems.', button: 'Reset workflow', state: 'complete' },
    { nodes: [], text: 'Illustrative sequence. No systems connected.', button: 'Trace the workflow', state: '' },
  ];
  button.addEventListener('click', () => {
    const stage = stages[step];
    map.dataset.state = stage.state;
    document.querySelectorAll('[data-node]').forEach(node => {
      node.classList.toggle('node-complete', stage.nodes.includes(node.dataset.node));
    });
    document.querySelector('.gate-status').textContent = stage.state === 'complete' ? 'APPROVED' : stage.state === 'review' ? 'AWAITING REVIEW' : 'GATED';
    status.textContent = stage.text;
    button.textContent = stage.button + ' ↗';
    step = (step + 1) % stages.length;
  });
})();
