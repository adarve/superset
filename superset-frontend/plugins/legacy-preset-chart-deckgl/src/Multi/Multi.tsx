/* eslint-disable react/jsx-handler-names */
/* eslint-disable react/no-access-state-in-setstate */
/* eslint-disable camelcase */
/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { isEqual } from 'lodash';
import {
  Datasource,
  HandlerFunction,
  JsonObject,
  JsonValue,
  QueryFormData,
  SupersetClient,
  usePrevious,
} from '@superset-ui/core';
import { Layer } from '@deck.gl/core';

import {
  DeckGLContainerHandle,
  DeckGLContainerStyledWrapper,
} from '../DeckGLContainer';
import { getExploreLongUrl } from '../utils/explore';
import layerGenerators from '../layers';
import { Viewport } from '../utils/fitViewport';
import { TooltipProps } from '../components/Tooltip';

export type DeckMultiProps = {
  formData: QueryFormData;
  payload: JsonObject;
  setControlValue: (control: string, value: JsonValue) => void;
  viewport: Viewport;
  onAddFilter: HandlerFunction;
  height: number;
  width: number;
  datasource: Datasource;
  onSelect: () => void;
};

const DeckMulti = (props: DeckMultiProps) => {
  const containerRef = useRef<DeckGLContainerHandle>();

  const [viewport, setViewport] = useState<Viewport>();
  const [subSlicesLayers, setSubSlicesLayers] = useState<Record<number, Layer>>(
    {},
  );

  const setTooltip = useCallback((tooltip: TooltipProps['tooltip']) => {
    const { current } = containerRef;
    if (current) {
      current.setTooltip(tooltip);
    }
  }, []);

  const loadLayers = useCallback(
    (formData: QueryFormData, payload: JsonObject, viewport?: Viewport) => {
      setViewport(viewport);
      setSubSlicesLayers({});
      
      // Log the payload to help diagnose what filter information is available
      console.log('Multi chart payload:', payload);
      
      // Attempt to extract global filter state from payload
      const filterState = {
        // Look for standard filter properties
        filters: formData.filters || [],
        extraFilters: formData.extra_filters || [],
        adhocFilters: formData.adhoc_filters || [],
        
        // Look for dashboard filter state in various locations
        nativeFilters: payload.nativeFilters || 
                      (payload.data && payload.data.nativeFilters) || [],
                      
        // Look for cross filter state
        crossFilters: payload.cross_filters || 
                     (payload.data && payload.data.cross_filters) || [],
                     
        // Look for URL state params
        urlParams: payload.url_params || 
                  (payload.data && payload.data.url_params) || {},
                  
        // Get dashboard id if available for cache coordination
        dashboardId: payload.dashboard_id ||
                    (payload.data && payload.data.dashboard_id) ||
                    formData.dashboard_id
      };
      
      console.log('Filter state extracted:', filterState);
      
      payload.data.slices.forEach(
        (subslice: { slice_id: number } & JsonObject) => {
          // Filters applied to multi_deck are passed down to underlying charts
          // note that dashboard contextual information (filter_immune_slices and such) aren't
          // taken into consideration here
          
          // Base filters from the individual chart and Multi chart
          const filters = [
            ...(subslice.form_data.filters || []),
            ...filterState.filters,
          ];
          
          // Add all types of filters we extracted
          if (filterState.extraFilters.length > 0) {
            filters.push(...filterState.extraFilters);
          }
          
          if (filterState.adhocFilters.length > 0) {
            filters.push(...filterState.adhocFilters);
          }
          
          if (filterState.nativeFilters.length > 0) {
            filters.push(...filterState.nativeFilters);
          }
          
          // Extract any URL parameters related to filtering - both from internal state and window.location
          const dashboardQueryParams: Record<string, any> = {};
          
          // Check for filter params in the payload urlParams
          if (filterState.urlParams) {
            // Extract filter-related URL params
            Object.entries(filterState.urlParams).forEach(([key, value]) => {
              if (key.includes('filter') || key.includes('FILTER')) {
                dashboardQueryParams[key] = value;
              }
            });
          }
          
          // Also get filter params directly from the current URL
          // This is more likely to have the current filter state
          const urlParams = new URLSearchParams(window.location.search);
          urlParams.forEach((value, key) => {
            if (key.includes('filter') || key.includes('FILTER') || 
                key.includes('dashboard') || key === 'preselect_filters') {
              dashboardQueryParams[key] = value;
            }
          });
          
          // Try to parse any filter state from hash fragment 
          try {
            const hashParams = window.location.hash
              .substring(1)
              .split('&')
              .map(param => {
                const [key, value] = param.split('=');
                return { key, value: decodeURIComponent(value) };
              })
              .filter(param => 
                param.key.includes('filter') || 
                param.key.includes('FILTER') ||
                param.key.includes('dashboard')
              );
              
            hashParams.forEach(param => {
              if (param.key && param.value) {
                dashboardQueryParams[param.key] = param.value;
              }
            });
          } catch (e) {
            console.error('Error parsing hash parameters:', e);
          }
          
          // Create a copy of the subslice with combined filters for the API request
          const subsliceCopy = {
            ...subslice,
            form_data: {
              ...subslice.form_data,
              filters,
              // Pass extra_filters directly as well to ensure they're included
              extra_filters: filterState.extraFilters,
              // Include adhoc_filters if present
              ...(filterState.adhocFilters.length > 0 ? { adhoc_filters: filterState.adhocFilters } : {}),
              // Include time_range if it exists in parent (important for time filtering)
              ...(formData.time_range ? { time_range: formData.time_range } : {}),
              // Pass dashboard ID to ensure server can use cache coordination
              ...(filterState.dashboardId ? { dashboard_id: filterState.dashboardId } : {}),
              // Include force flag to make sure we get latest data
              force: true
            },
          };

          // Get the URL with the form_data parameters
          const url = getExploreLongUrl(
            subsliceCopy.form_data, 
            'json', 
            true, 
            {
              ...dashboardQueryParams,
              // Add additional flags to force fresh data and indicate filtering
              force: 'true',
              dashboard_id: filterState.dashboardId || undefined,
              dashboard_filter: 'true'
            }
          );

          if (url) {
            // Log the request URL and filter configuration for debugging
            console.log(`Requesting subchart ${subslice.slice_id} with URL:`, url);
            console.log(`Filters for subchart ${subslice.slice_id}:`, filters);
            
            SupersetClient.get({
              endpoint: url,
            })
              .then(({ json }) => {
                console.log(`Received data for subchart ${subslice.slice_id}:`, json);
                
                // Ensure we have a valid response with data
                if (json) {
                  // Make sure json.data exists even if empty
                  const processedJson = json.data ? json : { ...json, data: { features: [] } };
                  
                  // @ts-ignore TODO(hainenber): define proper type for `form_data.viz_type` and call signature for functions in layerGenerators.
                  const layer = layerGenerators[subsliceCopy.form_data.viz_type](
                    subsliceCopy.form_data,
                    processedJson,
                    props.onAddFilter,
                    setTooltip,
                    props.datasource,
                    [],
                    props.onSelect,
                  );
                  
                  setSubSlicesLayers(subSlicesLayers => ({
                    ...subSlicesLayers,
                    [subsliceCopy.slice_id]: layer,
                  }));
                }
              })
              .catch((error) => {
                console.error(`Error loading subchart ${subslice.slice_id}:`, error);
              });
          }
        },
      );
    },
    [props.datasource, props.onAddFilter, props.onSelect, setTooltip],
  );

  // Track previous values to detect changes
  // Track previous values to detect changes
  const prevDeckSlices = usePrevious(props.formData.deck_slices);
  const prevFilters = usePrevious(props.formData.filters);
  const prevExtraFilters = usePrevious(props.formData.extra_filters);
  const prevAdhocFilters = usePrevious(props.formData.adhoc_filters);
  const prevTimeRange = usePrevious(props.formData.time_range);
  const prevQueryData = usePrevious(props.payload?.data);
  
  // Add a reference to track window location changes
  // When filters are applied via the dashboard UI, the URL often changes
  const [locationHash, setLocationHash] = useState<string>(window.location.hash);
  const [locationSearch, setLocationSearch] = useState<string>(window.location.search);
  
  useEffect(() => {
    const { formData, payload } = props;
    
    // Log the entire payload to see what's available and what changes
    console.log('Multi chart - Complete Props:', {
      formData,
      payload,
      queriesData: payload,  // For consistency with naming in other places
    });
    
    // Check various conditions that should trigger a reload of layers
    const slicesChanged = !isEqual(prevDeckSlices, formData.deck_slices);
    const filtersChanged = !isEqual(prevFilters, formData.filters);
    const extraFiltersChanged = !isEqual(prevExtraFilters, formData.extra_filters);
    const adhocFiltersChanged = !isEqual(prevAdhocFilters, formData.adhoc_filters);
    const timeRangeChanged = !isEqual(prevTimeRange, formData.time_range);
    
    // Check specifically for changes in the actual features data
    const payloadFeaturesChanged = 
      !isEqual(
        prevQueryData?.features, 
        payload?.data?.features
      );
    
    // Look for changes in any arbitrary properties of payload.data 
    // since we don't know exactly where filter state might be stored
    const payloadDataChanged = !isEqual(prevQueryData, payload?.data);
    
    // Check URL parameters for filter changes (dashboard URL often contains filter state)
    // Extract current URL parameters from window.location
    const urlParams = new URLSearchParams(window.location.search);
    const urlHash = window.location.hash;
    
    // Look for filter-related parameters in the URL
    let hasFilterInUrl = false;
    urlParams.forEach((value, key) => {
      if (key.includes('filter') || key.includes('FILTER')) {
        hasFilterInUrl = true;
      }
    });
    
    // Also check hash for filter parameters
    if (urlHash.includes('filter') || urlHash.includes('FILTER')) {
      hasFilterInUrl = true;
    }
    
    console.log('URL filter detection:', { 
      hasFilterInUrl, 
      urlParams: Object.fromEntries(urlParams.entries()), 
      urlHash 
    });
    
    const hasChanges = slicesChanged || filtersChanged || extraFiltersChanged || 
                      adhocFiltersChanged || timeRangeChanged || 
                      payloadFeaturesChanged || payloadDataChanged || 
                      hasFilterInUrl;
    
    if (hasChanges) {
      console.log('Multi chart - detected changes requiring reload:', {
        slicesChanged,
        filtersChanged,
        extraFiltersChanged,
        adhocFiltersChanged,
        timeRangeChanged,
        payloadFeaturesChanged,
        payloadDataChanged,
        hasFilterInUrl,
        locationHash,
        locationSearch
      });
      loadLayers(formData, payload);
    } else {
      // Force reload on any component update to test if filtering is working
      // This is a more aggressive approach that will help identify if filters work at all
      console.log('Multi chart - forcing reload to test filter propagation');
      loadLayers(formData, payload);
    }
  }, [
    loadLayers, 
    prevDeckSlices, 
    prevFilters, 
    prevExtraFilters, 
    prevAdhocFilters,
    prevTimeRange,
    prevQueryData,
    locationHash,
    locationSearch,
    props
  ]);
  
  // Add effect to watch for URL changes which might indicate filter changes
  useEffect(() => {
    const handleHashChange = () => {
      setLocationHash(window.location.hash);
      setLocationSearch(window.location.search);
    };
    
    // Listen for hash/search changes
    window.addEventListener('hashchange', handleHashChange);
    
    // Listen for history changes 
    const originalPushState = window.history.pushState;
    window.history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      handleHashChange();
      return result;
    };
    
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.history.pushState = originalPushState;
    };
  }, []);

  const { payload, formData, setControlValue, height, width } = props;
  const layers = Object.values(subSlicesLayers);

  return (
    <DeckGLContainerStyledWrapper
      ref={containerRef}
      mapboxApiAccessToken={payload.data.mapboxApiKey}
      viewport={viewport || props.viewport}
      layers={layers}
      mapStyle={formData.mapbox_style}
      setControlValue={setControlValue}
      onViewportChange={setViewport}
      height={height}
      width={width}
    />
  );
};

export default memo(DeckMulti);
