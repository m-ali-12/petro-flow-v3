
window.Transactions = (function () {
  const sb = () => window.supabaseClient;

  async function create({ type, category, amount, method, note }) {
    const { data, error } = await sb()
      .from('transactions')
      .insert([{
        type,
        category,
        amount,
        method,
        note
      }])
      .select()
      .single();

    if (error) {
      console.error("Transaction error:", error);
      return null;
    }

    return data;
  }

  async function getAll() {
    const { data } = await sb()
      .from('transactions')
      .select('*')
      .order('created_at', { ascending: false });

    return data || [];
  }

  return { create, getAll };
})();
