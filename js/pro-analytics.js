
window.ProAnalytics = (function () {
  const sb = () => window.supabaseClient;

  async function summary() {
    const { data } = await sb().from('transactions').select('*');

    let credit = 0, debit = 0;

    (data || []).forEach(t => {
      if (t.type === 'credit') credit += Number(t.amount);
      if (t.type === 'debit') debit += Number(t.amount);
    });

    return {
      credit,
      debit,
      balance: credit - debit
    };
  }

  async function byEmployee() {
    const { data } = await sb().from('transactions').select('*');

    const map = {};

    (data || []).forEach(t => {
      if (t.category === 'salary') {
        const name = t.note || "Employee";
        if (!map[name]) map[name] = 0;
        map[name] += Number(t.amount);
      }
    });

    return map;
  }

  return { summary, byEmployee };
})();
