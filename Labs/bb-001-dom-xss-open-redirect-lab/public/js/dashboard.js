async function loadUserData() {
    const res = await fetch('/api/user');
    if (!res.ok) return location.href = '/app/login';
    const user = await res.json();
    document.getElementById('userName').innerText = user.name;
    document.getElementById('userEmail').innerText = user.email;
    document.getElementById('memberSince').innerText = new Date(user.memberSince).toLocaleDateString();
    const list = document.getElementById('campaignList');
    list.innerHTML = '';
    user.campaigns.forEach(c => { const li = document.createElement('li'); li.textContent = c; list.appendChild(li); });
}
loadUserData();