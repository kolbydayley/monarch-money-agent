global.fetch = async (url, options) => {
  if (url !== 'https://api.monarch.com/graphql') throw new Error('Unexpected URL');
  const body = JSON.parse(options.body);
  const mode = process.env.MOCK_MODE;
  if (mode === 'error') return { ok: false, status: 401, text: async () => JSON.stringify({ private: 'DO_NOT_ECHO_ACCOUNT_DATA' }) };
  if (mode === 'nonjson') return { ok: false, status: 502, text: async () => 'DO_NOT_ECHO_ACCOUNT_DATA' };
  if (mode === 'graphql-error') return { ok: true, status: 200, text: async () => JSON.stringify({errors:[{message:'DO_NOT_ECHO_ACCOUNT_DATA'}]}) };
  if (/^\s*mutation\b/.test(body.query)) {
    if (process.env.MONARCH_ALLOW_WRITES !== '1') throw new Error('Mutation bypassed guard');
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: { updateTransaction: {transaction:{ id: 'synthetic-id' }} } }) };
  }
  return { ok: true, status: 200, text: async () => JSON.stringify({data:{categories:[{id:'synthetic-category',name:'Groceries',group:{id:'synthetic-group',name:'Food',type:'expense'}}]}}) };
};
