'use strict';

(async () => {

  const obyteAddressInput = $('#input-obyte-address');
  const btnClear = $('#btn-clear');
  const topHodlers = $('#top-hodlers');
  const cardContainer = $('#card-container');
  const totalContainer = $('#total-container');
  const chartContainer = $('#chart-container');
  const loadingContainer = $('#loading-container');
  const exchangesContainer = $('#exchanges-container');
  const addressLinksContainer = $('#address-links-container');
  const addressTypeContainer = $('#address-type');

  const template = $('#card-template')[0].innerHTML;

  const swapBaseAAs = ['GS23D3GQNNMNJ5TL4Z5PINZ5626WASMA'];
  const curveBaseAAs = ['FCFYMFIOGS363RLDLEWIDBIIBU7M7BHP', '3RNNDX57C36E76JLG2KAQSIASAYVGAYG'];
  const depositBaseAAs = ['GEZGVY4T3LK6N4NJAKNHNQIVAI5OYHPC'];
  const arbBaseAAs = ['7DTJZNB3MHSBVI72CKXRIKONJYBV7I2Z', 'WQBLYBRAMJVXDWS7BGTUNUTW2STO6LYP'];
  const client = new obyte.Client('wss://obyte.org/bb', {reconnect: true});
  let chart;

  async function getObyteMarketData() {
    const requestResult = await fetch('https://api.coinpaprika.com/v1/coins/gbyte-obyte/markets');
    const result = await requestResult.json();

    const exchangesPrices = result
      .map(item => {
        return {
          marketUrl: item.market_url,
          pair: item.pair,
          exchangeId: item.exchange_id,
          exchangeName: item.exchange_name,
          price: item.quotes.USD.price
        }
      }).filter(item => {
        return ['bittrex', 'bit-z', 'cryptox', 'bitladon'].includes(item.exchangeId);
      });

    const averageUSDPrice = exchangesPrices.reduce((sum, item) => {
      return sum + item.price;
    }, 0) / exchangesPrices.length;

    exchangesPrices.forEach(market => {
      exchangesContainer
        .append(`<div class="col-6"><a class="text-center"${(market.marketUrl ? ` href="${market.marketUrl}"` : '')} target="_blank"><strong>$${market.price.toFixed(2)}</strong> <span class="d-block">${market.exchangeName} <small>(${market.pair})</small></span></a></div>`);
    });

    return {
      exchangesPrices,
      averageUSDPrice
    }
  }

  async function getBalances(address) {
    return new Promise((resolve, reject) => {
      client.api.getBalances([address], function (err, result) {

        if (err) {
          return reject(err);
        }

        return resolve(result[address]);
      });
    });
  }

  async function getAssetDataFromAaVars() {
    const assets = {};
    const descriptions = {};
    return new Promise((resolve, reject) => {
      client.api.getAaStateVars({
        address: 'O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ',
        var_prefix: `a2s_`,
      }, function (err, assetNames) {
        if (err) {
          return reject(err);
        }
        Object.keys(assetNames).forEach(var_name => {
          let assetID = var_name.replace('a2s_', '');
          assets[assetID] = assets[assetID] || {};
          assets[assetID].name = assetNames[var_name];
        });
        client.api.getAaStateVars({
          address: 'O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ',
          var_prefix: `current_desc_`,
        }, function (err, assetDescripitons) {
          if (err) {
            return reject(err);
          }
          Object.keys(assetDescripitons).forEach(var_name => {
            descriptions[assetDescripitons[var_name]] = var_name.replace('current_desc_', '');
          });
          client.api.getAaStateVars({
            address: 'O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ',
            var_prefix: `decimals_`,
          }, function (err, assetDecimals) {
            if (err) {
              return reject(err);
            }
            Object.keys(assetDecimals).forEach(var_name => {
              let descriptionID = var_name.replace('decimals_', '');
              let assetID = descriptions[descriptionID];
              assets[assetID] = assets[assetID] || {};
              assets[assetID].decimal = assetDecimals[var_name];
            });
            return resolve(assets);
          });
        });
      });
    });
  }

  async function getDefinition(address) {
    return new Promise((resolve, reject) => {
      client.api.getDefinition(address, function (err, result) {

        if (err) {
          return reject(err);
        }

        return resolve(result);
      });
    });
  }

  async function getAddressAssets(address, marketData) {
    const currentGBytePrice = marketData.averageUSDPrice;
    const balance = await getBalances(address);
    if (!balance) {
      toastr.error('no balance for Obyte Address', 'Error');
      return;
    }

    const definition = await getDefinition(address);
    let addressType = 'unknown';
    if (definition) {
      if (definition[0] === 'sig') {
        addressType = 'regular';
      }
      else if (definition[0] === 'r of set') {
        addressType = 'multisig';
      }
      else if (definition[0] === 'and' || definition[0] === 'or') {
        addressType = 'smart-contract';
      }
      else if (definition[0] === 'autonomous agent') {
        addressType = 'autonomous agent';
        if (swapBaseAAs.includes(definition[1].base_aa)) {
          addressType = 'swap aa';
        }
        else if (curveBaseAAs.includes(definition[1].base_aa)) {
          addressType = 'curve aa';
        }
        else if (depositBaseAAs.includes(definition[1].base_aa)) {
          addressType = 'deposit aa';
        }
        else if (arbBaseAAs.includes(definition[1].base_aa)) {
          addressType = 'arb aa';
        }
      }
    }
    addressTypeContainer.text(addressType);

    const assetData = await getAssetDataFromAaVars();

    const currentPrices = await fetch('https://referrals.ostable.org/prices')
      .then(response => response.json());

    const balanceKeys = Object.keys(balance);
    const assets = await Promise.all(balanceKeys.map(async key => {
      const asset = assetData[key];
      if (!asset && key !== 'base') {
        return;
      }

      if (asset) {
        if (addressType === 'swap aa' && asset.name.startsWith('OPT-')) return false;
        if (addressType === 'curve aa' && (asset.name.startsWith('GR') || asset.name.startsWith('I'))) return false;
        if (addressType === 'deposit aa' && asset.name.startsWith('O')) return false;
        if (addressType === 'arb aa' && asset.name.endsWith('ARB')) return false;
      }

      const addressBalance = balance[key];
      let currentBalance;

      if (key === 'base') {
        currentBalance = addressBalance.total / Math.pow(10, 9);
        return {
          balance: currentBalance,
          baseBalance: addressBalance.total,
          currentValueInGB: currentBalance,
          currentValueInUSD: currentBalance * currentGBytePrice,
          unit: 'GBYTE'
        }
      }
      currentBalance = addressBalance.total / Math.pow(10, asset && asset.decimal ? asset.decimal : 0);

      const gbyteValue = currentPrices.data[key] / currentGBytePrice || 0;

      return {
        balance: currentBalance,
        baseBalance: addressBalance.total,
        decimal: asset.decimal,
        unit: asset.name,
        currentValueInGB: gbyteValue * currentBalance,
        currentValueInUSD: gbyteValue * currentBalance * currentGBytePrice,
      }
    }));

    return assets.filter(a => a).sort(function (a, b) {
      return b.currentValueInGB - a.currentValueInGB;
    });
  }

  function getTopHodlers() {
    fetch('https://referrals.ostable.org/distributions/next')
      .then(response => response.json())
      .then(response_json => response_json.data.balances.map(item => {
        return `<a href="#/${item.address}" class="address">${item.address}</a><br>`;
      }))
      .then(hodlers => {
        $('#hodlers-list').html(hodlers.slice(0, 10).join('\n'));
        $('#top-hodlers').removeClass('d-none');
      });
  }

  function clear() {
    $('.address-input-section').removeClass('mini');
    obyteAddressInput.val('');
    cardContainer.html('');
    totalContainer.addClass('d-none');
    chartContainer.addClass('d-none');
    addressLinksContainer.addClass('d-none');
    topHodlers.removeClass('d-none');
    btnClear.addClass('d-none');
    window.history.pushState(null, null, document.location.pathname);
    getTopHodlers();
  }

  function initToastr() {
    toastr.options = {
      closeButton: false,
      debug: false,
      newestOnTop: false,
      progressBar: true,
      positionClass: 'toast-top-right',
      preventDuplicates: true,
      onclick: null,
      showDuration: 300,
      hideDuration: 1000,
      timeOut: 5000,
      extendedTimeOut: 1000,
      showEasing: 'swing',
      hideEasing: 'linear',
      showMethod: 'fadeIn',
      hideMethod: 'fadeOut'
    }
  }

  async function getAssets() {
    const address = obyteAddressInput.val().trim();

    if (address.length === 0) {
      return;
    }

    const isValidAddress = obyte.utils.isValidAddress(address);

    if (!isValidAddress) {
      toastr.error('Invalid Obyte Address', 'Error');
      return;
    }

    const addressAsset = await getAddressAssets(address, marketData);
    if (!addressAsset) return;

    topHodlers.addClass('d-none');
    loadingContainer.removeClass('d-none');

    const totalGB = addressAsset.reduce((sum, item) => {
      return sum + item.currentValueInGB;
    }, 0);

    const totalUSD = addressAsset.reduce((sum, item) => {
      return sum + item.currentValueInUSD;
    }, 0);

    $('.address-input-section').addClass('mini');

    const chartAssetValueInGB = [];
    const chartAssetName = [];

    cardContainer.html('');
    addressAsset.forEach(asset => {
      chartAssetValueInGB.push(asset.currentValueInGB.toFixed(3));
      chartAssetName.push(asset.unit);

      let assetStyle = '';
      if (asset.unit.startsWith('OPT-')) {
        assetStyle = 'background: #008080;';
      } else if (asset.unit.endsWith('ARB')) {
        assetStyle = 'background: #800080;';
      } else if (asset.unit.startsWith('GR')) {
        assetStyle = 'background: red;';
      } else if (asset.unit.startsWith('O')) {
        assetStyle = 'background: green;';
      } else if (asset.unit.startsWith('I')) {
        assetStyle = 'background: blue;';
      }

      const tmp = template
        .replace(/{{asset}}/g, asset.unit)
        .replace(/{{assetStyle}}/g, assetStyle)
        .replace(/{{amount}}/g, asset.balance.toFixed(asset.decimal || (asset.unit === 'GBYTE' ? 9 : 0)))
        .replace(/{{amountInGB}}/g, Number(asset.currentValueInGB.toFixed(3)).toLocaleString())
        .replace(/{{amountInUSD}}/g, Number(asset.currentValueInUSD.toFixed(2)).toLocaleString());

      $('#card-container').append(tmp);
    });

    if (chart) {
      chart.destroy();
    }
    chart = new Chart($('#chart'), {
      type: 'doughnut',
      data: {
        datasets: [{
          data: chartAssetValueInGB,
          backgroundColor: [
            'rgba(255, 103, 0, 0.8)',
            'rgba(246, 62, 94, 0.8)',
            'rgba(196, 68, 140, 0.8)',
            'rgba(125, 83, 152, 0.8)',
            'rgba(64, 84, 129, 0.8)',
            'rgba(47, 72, 88, 0.8)',
            'rgba(194, 125, 0, 0.8)',
            'rgba(125, 135, 0, 0.8)',
            'rgba(36, 135, 0, 0.8)'
          ]
        }],
        labels: chartAssetName
      },
      options: {
        legend: {
          display: false
        },
        tooltips: {
          callbacks: {
            label: (tooltipItem, data) => {
              const dataset = data.datasets[tooltipItem.datasetIndex];
              const total = dataset.data.reduce((previousValue, currentValue) => {
                return previousValue + parseFloat(currentValue);
              }, 0);

              const currentValue = parseFloat(dataset.data[tooltipItem.index]) || 0;
              const currentLabel = data.labels[tooltipItem.index] || '';

              const precentage = Math.floor((currentValue / total) * 100);
              return `${currentLabel} \n ${precentage}% (${currentValue.toFixed(3)} GBYTE)`;
            }
          }
        }
      }
    });

    $('#open-explorer').attr('href', `https://explorer.obyte.org/#${address}`);
    $('#open-explorer2').attr('href', `https://obyte.io/@${address}`);
    $('#market-price').text(`1 GBYTE = $${marketData.averageUSDPrice.toFixed(2)}`);
    $('#market-price-reverse').text(`$1 = ${(1 / marketData.averageUSDPrice).toFixed(9)} GBYTE`);
    $('#total-gb').text(`${Number(totalGB.toFixed(3)).toLocaleString()} GBYTE`);
    $('#total-usd').text(`$${Number(totalUSD.toFixed(2)).toLocaleString()}`);
    loadingContainer.addClass('d-none');
    addressLinksContainer.removeClass('d-none');
    totalContainer.removeClass('d-none');
    chartContainer.removeClass('d-none');
    btnClear.removeClass('d-none');
  }

  initToastr();
  const marketData = await getObyteMarketData();

  obyteAddressInput.val(window.location.hash.replace(/^#\//, ''));
  if (obyteAddressInput.val()) {
    getAssets();
  } else {
    clear();
  }

  $(window).bind('hashchange', function (e) {
    const address = window.location.hash.replace(/^#\//, '');

    if (!address || address.length === 0) {
      clear();
      return;
    }
    obyteAddressInput.val(address);
    getAssets();
  });

  $('#obyte-address-form').on('submit', (e) => {
    e.preventDefault();
    window.history.replaceState(null, null, document.location.pathname + '#/' + obyteAddressInput.val().trim());
    getAssets();
  });

  btnClear.on('click', () => {
    clear();
  });

  $(document).on('click', '.coming-soon', () => {
    alert('Coming Soon');
  });


})();
