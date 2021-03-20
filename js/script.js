const client = new obyte.Client();

async function getObyteMarketData() {
  const requestResult = await fetch('https://api.coinpaprika.com/v1/coins/gbyte-obyte/markets');
  const result = await requestResult.json();

  const exchangesPrices = result
    .map(item => {
      return {
        exchangeId: item.exchange_id,
        exchangeName: item.exchange_name,
        price: item.quotes.USD.price
      }
    }).filter(item => {
      return item.exchangeId === 'bittrex';
    });

  const averageUSDPrice = exchangesPrices.reduce((sum, item) => {
    return sum + item.price;
  }, 0) / exchangesPrices.length;

  return {
    exchangesPrices,
    averageUSDPrice
  }
}

async function getAddressMetaData(address) {
  return new Promise((resolve, reject) => {
    client.api.getAssetMetadata(address, (err, result) => {
      if (err) {
        return reject(err);
      }
      return resolve(result);
    });
  })
}

async function getAssetData(address) {
  return new Promise((resolve, reject) => {
    client.api.getJoint(address, function (err, result) {
      if (err) {
        return reject(err);
      }
      const metaData = _.find(result.joint.unit.messages, {app: 'data'});
      return resolve({
        decimal: metaData.payload.decimals,
        name: metaData.payload.name
      });
    });
  });
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

async function getAssetNames(assetAddresses) {
  const assets = {};
  await Promise.all(assetAddresses.map(async address => {
    const metaData = await getAddressMetaData(address);
    assets[address] = await getAssetData(metaData.metadata_unit);
  }));
  return assets;
}

async function getAssetDataFromAaVars() {
  const assets = {};
  const descriptions = {};
  return new Promise((resolve, reject) => {
    client.api.getAaStateVars({
      address: 'O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ',
      var_prefix: `a2s_`,
    }, function(err, assetNames) {
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
      }, function(err, assetDescripitons) {
        if (err) {
          return reject(err);
        }
        Object.keys(assetDescripitons).forEach(var_name => {
          let assetID = var_name.replace('current_desc_', '');
          descriptions[assetDescripitons[var_name]] = assetID;
        });
        client.api.getAaStateVars({
          address: 'O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ',
          var_prefix: `decimals_`,
        }, function(err, assetDecimals) {
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

async function getAddressAssets(address, marketData) {
  const currentGBytePrice = marketData.averageUSDPrice;
  const balance = await getBalances(address);
  // const assetAddresses = _.chain(balance).keys().without('base').value();
  // const assetData = await getAssetNames(assetAddresses);
  const assetData = await getAssetDataFromAaVars();

  // const currentPrices = await fetch('https://data.ostable.org/api/v1/assets')
  //   .then(response => response.json());
  const currentPrices = await fetch('https://referrals.ostable.org/prices')
    .then(response => response.json());

  const balanceKeys = Object.keys(balance);
  return balanceKeys.map(key => {
    const asset = assetData[key];
    if (!asset) return;
    const addressBalance = balance[key];
    const currentBalance = addressBalance.total / Math.pow(10, asset && asset.decimal ? asset.decimal : 9);

    if (key === 'base') {
      return {
        balance: currentBalance,
        baseBalance: addressBalance.total,
        currentValueInGB: currentBalance,
        currentValueInUSD: currentBalance * currentGBytePrice,
        unit: 'GBYTE'
      }
    }

    // const currentGByteValue = _.find(currentPrices, {asset_id: key});
    // const gbyteValue = currentGByteValue ? currentGByteValue.last_gbyte_value : 0;
    const gbyteValue = currentPrices.data[key] / currentGBytePrice || 0;

    return {
      balance: currentBalance,
      baseBalance: addressBalance.total,
      decimal: asset.decimal,
      unit: asset.name,
      currentValueInGB: gbyteValue * currentBalance,
      currentValueInUSD: gbyteValue * currentBalance * currentGBytePrice,
    }
  }).filter(a => a);
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

(async () => {
  initToastr();

  const marketData = await getObyteMarketData();
  const template = $('#card-template')[0].innerHTML;

  fetch('https://referrals.ostable.org/distributions/next')
    .then(response => response.json())
    .then(response_json => response_json.data.balances.map(item => {
      return `<a href="#${item.address}" class="address">${item.address}</a><br>`;
    }))
    .then(hodlers => {
      $('#hodlers-list').html(hodlers.slice(0, 10).join("\n"));
      $('#top-hodlers').removeClass('d-none');
    });

  $('#input-obyte-address').val(window.location.hash.replace(/^#/,''));
  if ($('#input-obyte-address').val()) {
    getAssets();
  }

  $(window).bind( 'hashchange', function(e) {
    $('#input-obyte-address').val(window.location.hash.replace(/^#/,''));
    getAssets();
  });

  $('#obyte-address-form').on('submit', (e) => {
    e.preventDefault();
    window.history.replaceState(null, null, document.location.pathname + '#' + $('#input-obyte-address').val());
    getAssets();
  });
  
  async function getAssets() {
    const address = $('#input-obyte-address').val();

    if (address.length === 0) {
      return;
    }

    const isValidAddress = obyte.utils.isValidAddress(address);

    if (!isValidAddress) {
      toastr.error('Invalid Obyte Address', 'Error');
      return;
    }
    const addressAsset = await getAddressAssets(address, marketData);

    const totalGB = addressAsset.reduce((sum, item) => {
      return sum + item.currentValueInGB;
    }, 0);

    const totalUSD = addressAsset.reduce((sum, item) => {
      return sum + item.currentValueInUSD;
    }, 0);

    $('.address-input-section').addClass('mini');

    const chartAssetValueInGB = [];
    const chartAssetName = [];

    $('#card-container').html('');
    addressAsset.forEach(asset => {

      chartAssetValueInGB.push(asset.currentValueInGB.toFixed(3));
      chartAssetName.push(asset.unit);

      let assetStyle = '';
      if (asset.unit.startsWith("OPT-")) {
        assetStyle = 'background: #008080;';
      }
      else if (asset.unit.endsWith("ARB")) {
        assetStyle = 'background: #800080;';
      }
      else if (asset.unit.startsWith("GR")) {
        assetStyle = 'background: red;';
      }
      else if (asset.unit.startsWith("O")) {
        assetStyle = 'background: green;';
      }
      else if (asset.unit.startsWith("I")) {
        assetStyle = 'background: blue;';
      }

      const tmp = template
        .replace(/{{asset}}/g, asset.unit)
        .replace(/{{assetStyle}}/g, assetStyle)
        .replace(/{{amount}}/g, asset.balance.toFixed(asset.decimal || 9))
        .replace(/{{amountInGB}}/g, asset.currentValueInGB.toFixed(3))
        .replace(/{{amountInUSD}}/g, asset.currentValueInUSD.toFixed(2));

      $('#card-container').append(tmp);
    });

    $('#chart').html('');

    new Chart($('#chart'), {
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
          display: true,
          position: 'right',
          align: 'center',
          labels: {
            fontColor: 'rgb(255, 99, 132)'
          }
        },
        tooltips: {
          callbacks: {
            label: (tooltipItem, data) => {
              const dataset = data.datasets[tooltipItem.datasetIndex];
              const total = dataset.data.reduce((previousValue, currentValue) => {
                return previousValue + parseFloat(currentValue);
              }, 0);

              const currentValue = dataset.data[tooltipItem.index];
              const currentLabel = data.labels[tooltipItem.index];

              const precentage = Math.floor((currentValue / total) * 100);
              return `${currentLabel} \n ${precentage}% ($${currentValue.toFixed(2)})`;
            }
          }
        }
      }
    });

    $('#open-explorer').attr('href', `https://explorer.obyte.org/#${address}`);
    $('#open-explorer2').attr('href', `https://obyte.io/@${address}`);
    $('#market-price').text(`1 GBYTE = $${marketData.averageUSDPrice.toFixed(2)}`);
    $('#market-price-reverse').text(`$1 = ${(1/marketData.averageUSDPrice).toFixed(9)} GBYTE`);
    $('#total-gb').text(`${totalGB.toFixed(3)} GBYTE`);
    $('#total-usd').text(`$${totalUSD.toFixed(2)}`);
    $('#total-container').removeClass('d-none');
    $('#chart-container').removeClass('d-none');
  }

})();
